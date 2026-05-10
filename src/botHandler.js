/**
 * botHandler.js
 */

import { findDoctorByName } from './fuzzyMatch.js';
import { replyMessage } from './lineService.js';
import {
  buildElectiveReplyMessage,
  buildWelcomeMessage,
  getSetting,
} from './lineTemplates.js';

export async function handleLineEvent(event, db, env) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  if (!['group', 'room', 'user'].includes(event.source?.type)) return;

  const text       = event.message.text.trim();
  const replyToken = event.replyToken;
  const groupId    = event.source.groupId;
  const userId     = event.source.userId;
  const wordCount  = countWords(text);
  const sourceType = event.source?.type;

  // บันทึก group_id อัตโนมัติ (เฉพาะ group)
  if (groupId) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO settings(key,value) VALUES('line_group_id',?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value=''`,
      args: [groupId],
    });
  }

  // ── myid command — เฉพาะ DM เท่านั้น ────────────────────────────────────
  // อาจารย์/เลขา DM bot พิมพ์ "myid" → bot ตอบ userId
  // Admin เอา userId ไป insert liff_admins ใน Turso
  if (sourceType === 'user' && text.toLowerCase() === 'myid') {
    await replyMessage(
      replyToken,
      `🆔 LINE User ID ของคุณ:\n${userId}\n\nส่งเลขนี้ให้ Admin เพื่อขอสิทธิ์กรอกข้อมูลค่ะ`,
      env.LINE_CHANNEL_TOKEN
    );
    return;
  }

  const threshold = parseInt((await getSetting('fuzzy_threshold', db)) || '90', 10) || 90;

  // ── wordCount < 2 → hint หรือ silent (ยกเว้นชื่อ Latin คำเดียวที่ยาวพอ เช่นนามสกุลฝรั่ง) ──
  if (wordCount < 2) {
    const latinOneWordOk =
      /^[A-Za-z]/.test(text) &&
      !/[ก-๙]/.test(text) &&
      text.replace(/\s+/g, '').length >= 4;
    if (!latinOneWordOk) {
      const hint = 'กรุณาพิมพ์ "ชื่อ นามสกุล" ให้ครบ แล้วบอทจะตอบข้อมูลให้ค่ะ';

      if (sourceType === 'user' && isSingleThaiWord(text)) {
        await replyMessage(replyToken, hint, env.LINE_CHANNEL_TOKEN);
        return;
      }
      if (isSingleThaiWord(text)) {
        const q = String(text || '').trim();
        const { rows } = await db.execute({
          sql: `SELECT 1 FROM electives
                WHERE (status IS NULL OR status != 'deleted')
                AND name LIKE ? LIMIT 1`,
          args: [`%${q}%`],
        });
        if (rows?.length) {
          await replyMessage(replyToken, hint, env.LINE_CHANNEL_TOKEN);
          return;
        }
      }
      return;
    }
  }

  // ── match doctors ────────────────────────────────────────────────────────
  const { rows: doctors } = await db.execute(
    `SELECT * FROM doctors WHERE status IN ('active','upcoming')`
  );
  const dMatch = findDoctorByName(text, doctors, threshold);
  if (dMatch?.doctor) {
    const doctor = dMatch.doctor;
    if (doctor.status_check === 'replied') return;
    if (doctor.status === 'completed') return;
    const message = await buildWelcomeMessage(doctor, db);
    const ok = await replyMessage(replyToken, message, env.LINE_CHANNEL_TOKEN);
    if (ok) {
      await db.execute({
        sql: `UPDATE doctors SET status_check='replied', replied_at=? WHERE id=?`,
        args: [new Date().toISOString(), doctor.id],
      });
      await db.execute({
        sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','reply_sent_doctor',?,?)`,
        args: [doctor.name, JSON.stringify({ similarity: dMatch.similarity })],
      });
    }
    return;
  }

  // ── match electives ──────────────────────────────────────────────────────
  const { rows: electives } = await db.execute(
    `SELECT * FROM electives WHERE status IS NULL OR status != 'deleted' ORDER BY name`
  );
  const eMatch = findDoctorByName(text, electives, threshold);
  if (!eMatch?.doctor) {
    await db.execute({
      sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','line_no_match',?,?)`,
      args: [text, JSON.stringify({ elective_count: electives.length })],
    });
    return;
  }

  const elective = eMatch.doctor;
  const message = await buildElectiveReplyMessage(elective, db, null, text);
  const ok = await replyMessage(replyToken, message, env.LINE_CHANNEL_TOKEN);
  if (ok) {
    await db.execute({
      sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','reply_sent_elective',?,?)`,
      args: [elective.name, JSON.stringify({ similarity: eMatch.similarity })],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO logs(level,fn,message,meta) VALUES('WARN','line_reply_failed',?,?)`,
      args: [elective.name, JSON.stringify({ similarity: eMatch.similarity })],
    });
  }
}

function isSingleThaiWord(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return false;
  if (t.length < 2) return false;
  if (!/[ก-๙]/.test(t)) return false;
  return !/\s/.test(t);
}

function countWords(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function bestLooseMatch(text, list, looseThreshold = 70) {
  try {
    const m = findDoctorByName(text, list || [], looseThreshold);
    if (!m?.doctor) return null;
    return m;
  } catch {
    return null;
  }
}
