/**
 * botHandler.js
 */

import { findDoctorByName, normalizeName } from './fuzzyMatch.js';
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

  // ── wordCount < 2 → กันคำสั้น/ไม่ใช่ชื่อ ที่เหลือปล่อยให้ลง matcher ด้านล่าง ──
  if (wordCount < 2) {
    const latinOneWordOk =
      /^[A-Za-z]/.test(text) &&
      !/[ก-๙]/.test(text) &&
      text.replace(/\s+/g, '').length >= 4;
    if (!latinOneWordOk && !isSingleThaiWord(text)) return;
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

  // ── match electives (fuzzy ก่อน, ถ้าไม่ตรงค่อย loose match ตามชื่อจริง) ──
  const { rows: electives } = await db.execute(
    `SELECT * FROM electives WHERE status IS NULL OR status != 'deleted' ORDER BY name`
  );
  const eMatch = findDoctorByName(text, electives, threshold);
  let elective = eMatch?.doctor || null;
  let matchKind = elective ? 'fuzzy' : '';

  if (!elective) {
    const loose = isNameLikeQuery(text) ? findLooseElectiveMatches(text, electives) : [];
    if (loose.length === 1) {
      elective = loose[0];
      matchKind = 'loose';
    } else if (loose.length > 1) {
      await replyMessage(replyToken, buildIncompleteNameHint(text, loose), env.LINE_CHANNEL_TOKEN);
      await db.execute({
        sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','line_name_ambiguous',?,?)`,
        args: [text, JSON.stringify({ match_count: loose.length })],
      });
      return;
    } else {
      // ไม่มั่นใจว่าใคร — ตอบ hint เฉพาะเมื่อดูเหมือนทักทาย/รายงานตัวเท่านั้น
      // ที่เหลือเงียบ (กัน bot ตอบทุกข้อความใน group และข้อความสุ่มใน DM)
      const intro = looksLikeIntroduction(text);
      if (intro) {
        await replyMessage(replyToken, needFullNameHint(text), env.LINE_CHANNEL_TOKEN);
      }
      await db.execute({
        sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','line_no_match',?,?)`,
        args: [text, JSON.stringify({ elective_count: electives.length, intro, source: sourceType })],
      });
      return;
    }
  }

  const message = await buildElectiveReplyMessage(elective, db, null, text);
  const ok = await replyMessage(replyToken, message, env.LINE_CHANNEL_TOKEN);
  await db.execute({
    sql: `INSERT INTO logs(level,fn,message,meta) VALUES(?,?,?,?)`,
    args: [
      ok ? 'INFO' : 'WARN',
      ok ? 'reply_sent_elective' : 'line_reply_failed',
      elective.name,
      JSON.stringify({ similarity: eMatch?.similarity ?? null, match: matchKind }),
    ],
  });
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

const NEED_FULL_NAME_HINT_TH =
  'กรุณาพิมพ์ "ชื่อ นามสกุล" ให้ครบ แล้วบอทจะตอบข้อมูลให้ค่ะ';
const NEED_FULL_NAME_HINT_EN =
  'Please type your full name ("First Last") and the bot will reply with your schedule.';
// ตอบ 2 ภาษาเมื่อไม่แน่ใจว่าผู้ใช้สื่อภาษาใด
const NEED_FULL_NAME_HINT = `${NEED_FULL_NAME_HINT_TH}\n${NEED_FULL_NAME_HINT_EN}`;

// เลือกภาษา hint ตามข้อความที่พิมพ์ (อังกฤษล้วน → EN, มีไทย → TH, อื่น ๆ → 2 ภาษา)
function needFullNameHint(text) {
  const t = String(text || '');
  const hasThai = /[ก-๙]/.test(t);
  const hasLatin = /[A-Za-z]/.test(t);
  if (hasLatin && !hasThai) return NEED_FULL_NAME_HINT_EN;
  if (hasThai && !hasLatin) return NEED_FULL_NAME_HINT_TH;
  return NEED_FULL_NAME_HINT;
}

// คำที่บ่งชี้ว่าน่าจะเป็นการทักทาย/รายงานตัว (ถึงจะจับชื่อไม่ได้ ก็ควรตอบ hint ให้พิมพ์ชื่อให้ครบ)
const INTRO_KEYWORDS = [
  // ── ไทย ──
  'สวัสดี', 'สวัดดี', 'หวัดดี', 'สวีสดี',
  'รายงานตัว', 'แนะนำตัว', 'ทักทาย',
  'หนูชื่อ', 'ผมชื่อ', 'ดิฉันชื่อ', 'ชื่อเล่น',
  'มาดูงาน', 'ดูงาน', 'อีเลคทีฟ', 'อิเลคทีฟ',
  // ── อังกฤษ ──
  'hello', 'good morning', 'good afternoon', 'good evening',
  'my name', "i'm ", 'i am ', 'this is ', 'introduce', 'report',
  'elective', 'int.', 'intern', 'international', 'student',
];
function looksLikeIntroduction(text) {
  const t = String(text || '').toLowerCase();
  if (t.replace(/\s+/g, '').length < 4) return false;
  return INTRO_KEYWORDS.some(k => t.includes(k));
}

// ข้อความนี้ "ดูเหมือนการพิมพ์ชื่อ" ไหม — กันไม่ให้ loose match จับประโยค/ข้อความสุ่มในกลุ่มที่คุยกันปกติ
function isNameLikeQuery(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.replace(/\s+/g, '').length > 30) return false;          // ยาวเกินไป = น่าจะเป็นประโยค
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 3) return false;                          // คำเยอะ = ไม่ใช่แค่ชื่อ
  if (/[?!@#$%^&*()_=+[\]{};:"<>/\\|]/.test(t)) return false;    // มีสัญลักษณ์แบบประโยค/พิมพ์ลวก
  return /[ก-๙A-Za-z]/.test(t);                                 // ต้องมีตัวอักษรชื่อจริง
}

// แปลงข้อความเป็น token ชื่อ (ตัดคำนำหน้า/วงเล็บ/สัญลักษณ์ออก เหลือเฉพาะคำที่เป็นชื่อ)
function nameTokens(text) {
  return normalizeName(text)
    .split(/\s+/)
    .map(token => token.replace(/^[^ก-๙A-Za-z]+|[^ก-๙A-Za-z]+$/g, ''))
    .filter(Boolean);
}

// คีย์เทียบชื่อ — ตัดวรรณยุกต์/การันต์ออก เพื่อให้ "สิริภัทร์" ≈ "สิริภัทร"
function matchKey(token) {
  return String(token || '')
    .replace(/[\u0E47-\u0E4E]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function electiveNameKeys(elective) {
  const out = [];
  for (const raw of [elective?.name, elective?.name_en]) {
    if (!String(raw || '').trim()) continue;
    for (const token of nameTokens(raw)) {
      const k = matchKey(token);
      if (k.length >= 2) out.push(k);
    }
  }
  return out;
}

function tokenMatches(nameKey, queryKey) {
  if (!nameKey || !queryKey) return false;
  if (nameKey === queryKey) return true;
  // พิมพ์ไม่ครบเล็กน้อย เช่น "สิริภัทร" → ชื่อจริง "สิริภัทรา"
  if (queryKey.length >= 2 && nameKey.startsWith(queryKey)) return true;
  if (nameKey.length >= 3 && queryKey.startsWith(nameKey)) return true;
  return false;
}

// หา elective ที่ "ชื่อจริง" (คำแรก) ตรงกับที่พิมพ์ ถ้าซ้ำกันก็ใช้คำถัดไป (นามสกุล) ช่วยกรอง
function findLooseElectiveMatches(text, electives) {
  const qKeys = nameTokens(text).map(matchKey).filter(k => k.length >= 2);
  // ชื่อจริง (คำแรก) ต้องยาวพอ ไม่งั้นคำสั้น ๆ จะ prefix ตรงกับหลายชื่อจนตอบมั่ว
  if (!qKeys.length || qKeys[0].length < 3) return [];
  const given = qKeys[0];

  let candidates = uniqueById((electives || []).filter(e =>
    electiveNameKeys(e).some(nk => tokenMatches(nk, given))
  ));

  if (candidates.length > 1 && qKeys.length > 1) {
    const narrowed = candidates.filter(e => {
      const keys = electiveNameKeys(e);
      return qKeys.slice(1).some(qk => keys.some(nk => tokenMatches(nk, qk)));
    });
    if (narrowed.length >= 1) candidates = narrowed;
  }
  return candidates;
}

function buildIncompleteNameHint(query, matches) {
  const isEn = /[A-Za-z]/.test(String(query || '')) && !/[ก-๙]/.test(String(query || ''));
  const base = isEn
    ? `"${query}" is not specific enough. Please type your full name ("First Last") so the bot can find your schedule.`
    : `ชื่อ "${query}" ยังไม่ครบค่ะ กรุณาพิมพ์ "ชื่อ นามสกุล" ให้ครบ เพื่อให้บอทค้นหาตารางได้แม่นยำค่ะ`;
  if (!matches?.length) return base;

  const list = matches
    .slice(0, 6)
    .map(e => `• ${(isEn && String(e.name_en || '').trim()) || e.name}`)
    .join('\n');
  const more = matches.length > 6
    ? (isEn ? `\n...and ${matches.length - 6} more` : `\n...และอีก ${matches.length - 6} คน`)
    : '';
  const header = isEn ? 'Matching names found:' : 'พบชื่อจริงนี้ได้หลายคน:';
  return `${base}\n\n${header}\n${list}${more}`;
}

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.id || row?.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
