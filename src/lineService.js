/**
 * lineService.js
 * เทียบเท่า LineService.gs
 */

// ── Verify LINE signature ──────────────────────────────────
// เทียบเท่า verifySignature() ใน LineService.gs
// Apps Script: Utilities.computeHmacSha256Signature()
// Worker:      Web Crypto API (SubtleCrypto) — เร็วกว่า, built-in
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === signature;
  } catch {
    return false;
  }
}

// ── Reply Message ─────────────────────────────────────────
// เทียบเท่า replyMessage() ใน LineService.gs
// Apps Script: UrlFetchApp.fetch() — sync, ช้า
// Worker:      fetch() — async, edge, เร็วมาก
export async function replyMessage(replyToken, text, lineToken) {
  if (!replyToken || replyToken === 'TEST_REPLY_TOKEN') return false;
  if (!lineToken) return false;

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
  return res.ok;
}

// ── Push Message ──────────────────────────────────────────
// เทียบเท่า pushMessage() ใน LineService.gs
export async function pushMessage(to, text, lineToken) {
  if (!to || !lineToken) return false;

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  });
  return res.ok;
}

// ── Check Quota ───────────────────────────────────────────
export async function checkQuota(lineToken) {
  if (!lineToken) return null;
  const [q, c] = await Promise.all([
    fetch('https://api.line.me/v2/bot/message/quota', {
      headers: { Authorization: `Bearer ${lineToken}` },
    }),
    fetch('https://api.line.me/v2/bot/message/quota/consumption', {
      headers: { Authorization: `Bearer ${lineToken}` },
    }),
  ]);
  if (!q.ok || !c.ok) return null;
  const quota = await q.json();
  const cons  = await c.json();
  const used  = cons.totalUsage || 0;
  const total = quota.value || 300;
  return { used, total, percentage: Math.round((used / total) * 100) };
}
