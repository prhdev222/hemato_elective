/**
 * botHandler.js
 * เทียบเท่า handleEvent() ใน Code.gs + TemplateService.gs + DoctorService.gs
 */

import { findDoctorByName } from './fuzzyMatch.js';
import { replyMessage } from './lineService.js';
import {
  buildElectiveReplyMessage,
  buildWelcomeMessage,
  getSetting,
} from './lineTemplates.js';

// ── Main handler ────────────────────────────────────────────
// เทียบเท่า handleEvent() ใน Code.gs
export async function handleLineEvent(event, db, env) {
  // รับเฉพาะ text message — Silent Mode
  if (event.type !== 'message' || event.message.type !== 'text') return;
  // อนุญาตทั้ง group / room / user (แชทส่วนตัว) เพื่อให้ทดสอบได้ง่าย
  if (!['group', 'room', 'user'].includes(event.source?.type)) return;

  const text       = event.message.text;
  const replyToken = event.replyToken;
  const groupId    = event.source.groupId;
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

  const threshold = parseInt((await getSetting('fuzzy_threshold', db)) || '90', 10) || 90;

  // ถ้าพิมพ์ “ชื่ออย่างเดียว” (ไม่มีนามสกุล) → ห้ามตอบข้อมูลจริง
  // เพื่อกันชื่อซ้ำ ให้ตอบเฉพาะข้อความแนะนำเมื่อคล้ายชื่อใน electives แบบหลวมๆ
  if (wordCount < 2) {
    const hint =
      'กรุณาพิมพ์ “ชื่อ นามสกุล” ให้ครบ แล้วบอทจะตอบข้อมูลให้ค่ะ';

    // แชทส่วนตัว: ตอบทันทีเมื่อดูเหมือนพิมพ์ชื่ออย่างเดียว
    if (sourceType === 'user' && isSingleThaiWord(text)) {
      await replyMessage(replyToken, hint, env.LINE_CHANNEL_TOKEN);
      return;
    }

    // ในกลุ่ม/ห้อง: กันตอบมั่ว → ตอบเมื่อคล้ายชื่อ elective แบบหลวมๆ เท่านั้น
    if (isSingleThaiWord(text)) {
      const q = String(text || '').trim();
      const { rows } = await db.execute({
        sql: `SELECT 1 FROM electives
              WHERE (status IS NULL OR status != 'deleted')
              AND name LIKE ?
              LIMIT 1`,
        args: [`%${q}%`],
      });
      if (rows?.length) {
        await replyMessage(replyToken, hint, env.LINE_CHANNEL_TOKEN);
        return;
      }
    }
    return; // Silent mode สำหรับแชททั่วไป
  }

  // 1) match doctors ก่อน (พฤติกรรมเดิม: ส่ง welcome ครั้งเดียว)
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

  // 2) match electives → ตอบกลับแบบ reply message (ไม่ต้อง greeting)
  const { rows: electives } = await db.execute(
    `SELECT * FROM electives WHERE status IS NULL OR status != 'deleted' ORDER BY name`
  );
  const eMatch = findDoctorByName(text, electives, threshold);
  if (!eMatch?.doctor) {
    await db.execute({
      sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','line_no_match',?,?)`,
      args: [text, JSON.stringify({ elective_count: electives.length })],
    });
    return; // Silent Mode
  }

  const elective = eMatch.doctor;
  const message = await buildElectiveReplyMessage(elective, db);
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

  // ถ้ามีช่องว่างแล้ว ถือว่า "พยายามพิมพ์ชื่อ-นามสกุล" แล้ว → ไม่ต้อง hint
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return false;

  // ข้อความสั้นมาก/ไม่ใช่ชื่อ → ไม่ต้อง hint
  if (t.length < 2) return false;

  // ต้องมีตัวอักษรไทยอย่างน้อย 1 ตัว (ลดการตอบกับข้อความอื่น)
  if (!/[ก-๙]/.test(t)) return false;

  // ไม่มีช่องว่าง + มีตัวอักษรไทย + ความยาวพอดี → คาดว่าเป็น “ชื่ออย่างเดียว”
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
    return m; // { doctor, similarity }
  } catch {
    return null;
  }
}
