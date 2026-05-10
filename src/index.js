/**
 * HSOS Cloudflare Worker
 * เทียบเท่า Code.gs (doPost + doGet) + ทุก .gs
 * Stack: Cloudflare Worker + Turso (libSQL)
 */

import { createClient } from '@libsql/client/web';
import { verifySignature } from './lineService.js';
import { handleLineEvent } from './botHandler.js';
import { router } from './apiRouter.js';

/** Turso libSQL client หรือ Response ผิดพลาดเมื่อตั้งค่าไม่ครบ */
function getDbOrError(env, cors) {
  if (!env.TURSO_URL || !env.TURSO_TOKEN) {
    return {
      error: json(
        {
          success: false,
          error:
            'Worker ยังไม่มี TURSO_URL / TURSO_TOKEN (ไป Cloudflare Dashboard → Workers → hsos-worker → Settings → Variables แล้วใส่ Secret ทั้งสองตัว หรือรัน wrangler secret put)',
        },
        cors,
        503
      ),
    };
  }
  return { db: createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS headers ──
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ── GET /api/* → Admin API ──
      if (request.method === 'GET' && url.pathname.startsWith('/api')) {
        const got = getDbOrError(env, cors);
        if (got.error) return got.error;
        const res = await router.handleGet(request, got.db, env);
        return json(res, cors, res?.status || 200);
      }

      // ── POST ──
      if (request.method === 'POST') {
        const body = await request.text();

        // LINE Webhook → /webhook
        if (url.pathname === '/webhook') {
          const got = getDbOrError(env, cors);
          if (got.error) return got.error;
          const db = got.db;
          const sig = request.headers.get('x-line-signature');
          const ok = await verifySignature(body, sig, env.LINE_CHANNEL_SECRET);
          if (!ok) {
            await log(db, 'WARN', 'line_signature_failed', 'LINE signature verify failed', {
              hasSignature: Boolean(sig),
              bodyLength: body.length,
            });
            return new Response('Unauthorized', { status: 401 });
          }
          let payload;
          try {
            payload = JSON.parse(body);
          } catch (err) {
            await log(db, 'ERROR', 'line_invalid_json', err.message, { bodyLength: body.length });
            return new Response('Bad Request', { status: 400 });
          }
          await log(db, 'INFO', 'line_webhook_received', `events=${payload.events?.length || 0}`, {
            events: (payload.events || []).map(e => ({
              type: e.type,
              sourceType: e.source?.type,
              text: e.message?.type === 'text' ? e.message.text : undefined,
            })),
          });
          for (const event of payload.events || []) {
            try {
              await handleLineEvent(event, db, env);
            } catch (err) {
              await log(db, 'ERROR', 'line_event_error', err.message, {
                eventType: event.type,
                sourceType: event.source?.type,
              });
            }
          }
          return new Response('OK');
        }

        // Admin API → /api/*
        if (url.pathname.startsWith('/api')) {
          let data;
          try {
            data = JSON.parse(body || '{}');
          } catch {
            return json({ success: false, error: 'Invalid JSON body' }, cors, 400);
          }
          const got = getDbOrError(env, cors);
          if (got.error) return got.error;
          const res = await router.handlePost(request, data, got.db, env);
          return json(res, cors, res?.status || 200);
        }
      }

      // ── Health check ──
      return json({
        status: 'HSOS Worker ✅',
        time: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      }, cors);

    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: err.message }, cors, 500);
    }
  },

  // ── Cron handler: รันตามตารางใน wrangler.toml [triggers] ──────
  async scheduled(event, env, ctx) {
    if (!env.TURSO_URL || !env.TURSO_TOKEN) {
      console.error('cron skipped: TURSO_URL/TURSO_TOKEN missing');
      return;
    }
    const db = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
    const keepDays = parseInt(env.LOG_KEEP_DAYS || '7', 10);
    try {
      // ลบ log เก่ากว่า keepDays วัน
      const result = await db.execute({
        sql: `DELETE FROM logs WHERE ts < datetime('now', ?)`,
        args: [`-${keepDays} days`],
      });
      // นับจำนวน log ที่เหลือ เพื่อบันทึกลง log เอง
      const { rows } = await db.execute(`SELECT COUNT(*) as n FROM logs`);
      const remaining = rows[0]?.n || 0;
      await log(db, 'INFO', 'cron_log_cleanup',
        `deleted logs older than ${keepDays} days; remaining=${remaining}`,
        { cron: event.cron, keepDays, remaining });
    } catch (err) {
      console.error('cron cleanup failed:', err);
      try {
        await log(db, 'ERROR', 'cron_log_cleanup_failed', err.message, { cron: event.cron });
      } catch { /* ignore */ }
    }
  },
};

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function log(db, level, fn, message, meta = {}) {
  try {
    await db.execute({
      sql: `INSERT INTO logs(level, fn, message, meta) VALUES(?,?,?,?)`,
      args: [level, fn, message, JSON.stringify(meta)],
    });
  } catch (err) {
    console.error('log failed:', err);
  }
}
