/**
 * Shared LINE-style message builders + template helpers (DB templates + defaults)
 */

// ── Template defaults ────────────────────────────────────────
export const DEFAULT_TEMPLATES = {
  bot_welcome:
    'ยินดีต้อนรับคุณหมอ {{name}} ({{type}}) สู่สาขาโลหิตวิทยานะคะ! 🎉\n\n' +
    '📋 ข้อมูลการดูงาน:\n' +
    '• ช่วงที่ 1 ({{period1_dates}}): {{ward1}}\n' +
    '{{period2_block}}\n{{chief_block}}\n\n' +
    '{{opd_block}}\n\n' +
    '📚 คู่มือการดูงาน (PDF): {{pdf_manual_url}}\n' +
    '💬 หากมีข้อสงสัยถามในกลุ่ม LINE นี้ได้เลยค่ะ 🙏',
  bot_period2_block: '• ช่วงที่ 2 ({{period2_dates}}): {{ward2}}\n',
  bot_chief_block:
    '📍 สิ่งที่ต้องทำตอนนี้:\nรบกวนแอด LINE พี่ Chief ({{chief1_name}})\n👉 {{chief1_link}}',
  bot_chief2_block:
    '\nและรบกวนแอด LINE พี่ Chief ช่วงที่ 2 ({{chief2_name}})\n👉 {{chief2_link}}',
  bot_opd_calendar_block: '🏥 ตาราง OPD\n{{opd_lines}}',
  bot_opd_fallback_block: '🏥 OPD: {{opd_schedule}}\n⚡ หน้าที่: {{opd_role}}',
  bot_elective_reply:
    '🧑‍⚕️ {{name}} ({{level}})\n\n' +
    '{{period1_block}}{{period2_block}}\n\n' +
    '{{opd_block}}\n\n' +
    '📚 คู่มือ: {{pdf_manual_url}}',
  bot_elective_period1_block:
    '🟦 ช่วงที่ 1 ({{period1_dates}})\n' +
    '🏥 วอร์ด: {{ward1}}\n' +
    '👑 Chief (ติดต่อเพื่อราวด์วอร์ดช่วงที่ 1): {{chief1_name}} {{chief1_line}}\n' +
    '👨‍⚕️ อาจารย์ที่ต้องราวด์ด้วย: {{supervise1_list}}',
  bot_elective_period2_block:
    '\n\n🟧 ช่วงที่ 2 ({{period2_dates}})\n' +
    '🏥 วอร์ด: {{ward2}}\n' +
    '👑 Chief: {{chief2_name}} {{chief2_line}}\n' +
    '👨‍⚕️ อาจารย์ที่ต้องราวด์ด้วย: {{supervise2_list}}',

  // ── Elective reply (English) — ใช้เมื่อผู้ใช้พิมพ์เป็นภาษาอังกฤษ หรือ elective เป็นชื่อ EN / มี name_en ──
  bot_elective_reply_en:
    'Hello Dr. 🧑‍⚕️\n' +
    '{{display_name}} ({{level}}), your elective schedule is as follows:\n\n' +
    '{{period1_block_en}}' +
    '{{period2_block_en}}' +
    '{{opd_section_en}}\n\n' +
    '{{closing_wish}}\n\n' +
    '📚 Elective Handbook: {{pdf_manual_url}}\n' +
    '📚 Elective Calendar: {{elective_calendar_url}}',
  bot_elective_period1_block_en:
    '🟦 Period 1 ({{period1_dates_en}})\n' +
    '🏥 Ward: {{ward1_en}}\n' +
    '{{chief_detail1}}\n',
  bot_elective_period2_block_en:
    '\n🟧 Period 2 ({{period2_dates_en}})\n' +
    '🏥 Ward: {{ward2_en}}\n' +
    '{{chief_detail2}}\n',
  bot_elective_chief_detail_en:
    '👑 Chief: {{chief_name}}{{line_block}}{{attending_block}}',
  bot_elective_chief_line_en:
    '\n📱 LINE ID: {{line_display}}\n(Please add LINE to coordinate the ward round time and location.)',
  bot_elective_chief_attending_en:
    '\n👨‍⚕️ Attending physician for rounds: {{supervise_list}}',
  bot_opd_calendar_block_en:
    '🏥 OPD Schedule\n{{opd_lines_en}}',
  bot_opd_calendar_line_solo_en:
    '• {{date_en}} — Independent clinic practice',
  bot_opd_calendar_line_with_en:
    '• {{date_en}} — With {{supervisor}}',
  bot_elective_closing_en:
    'Wishing you a joyful and rewarding elective at Siriraj Hospital and a wonderful time in Thailand 🩷',
};

export const ELECTIVE_CALENDAR_URL_DEFAULT = 'https://hemato-elective.pages.dev/';

export async function getTemplate(key, db) {
  try {
    const { rows } = await db.execute({
      sql: `SELECT value FROM templates WHERE key=?`,
      args: [key],
    });
    if (rows[0]?.value) return rows[0].value;
  } catch { /* fallback */ }
  return DEFAULT_TEMPLATES[key] || '';
}

export async function getSetting(key, db) {
  try {
    const { rows } = await db.execute({
      sql: `SELECT value FROM settings WHERE key=?`,
      args: [key],
    });
    return rows[0]?.value || '';
  } catch {
    return '';
  }
}

export function fill(template, data) {
  if (!template) return '';
  let r = String(template);
  for (const [k, v] of Object.entries(data)) {
    r = r.split(`{{${k}}}`).join(v ?? '');
  }
  return r.replace(/\{\{[^}]+\}\}/g, '');
}

export function formatThaiDate(yyyyMmDd) {
  const s = String(yyyyMmDd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '';
  const d = new Date(`${s}T00:00:00Z`);
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(d);
}

export function formatThaiRange(rangeText) {
  const s = String(rangeText || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4}-\d{2}-\d{2})\s*(?:ถึง|to|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return s;
  const a = formatThaiDate(m[1]);
  const b = formatThaiDate(m[2]);
  return `${a} - ${b}`;
}

export async function getChiefsForMonth(db, monthYyyyMm) {
  const { rows } = await db.execute({
    sql: `SELECT * FROM chiefs WHERE month=?`,
    args: [monthYyyyMm],
  });
  const r = {};
  for (const c of rows) r[c.ward_code] = c;
  return { male: r.male, female: r.female };
}

export async function buildElectiveOPDBlock(elective, db) {
  try {
    if (!elective?.id) return '';
    const { rows } = await db.execute({
      sql: `SELECT oc.date, oc.opd_mode, s.name as supervisor_name
            FROM opd_calendar oc
            LEFT JOIN supervisors s ON s.id = oc.supervisor_id
            WHERE oc.date >= date('now')
              AND oc.elective_ids LIKE ?
            ORDER BY oc.date
            LIMIT 10`,
      args: [`%${elective.id}%`],
    });
    if (!rows.length) return '';
    const lines = rows
      .map(r => {
        const dateTH = formatThaiDate(r.date);
        const mode = (r.opd_mode || '').toLowerCase();
        if (mode === 'solo') return `• ${dateTH} — ตรวจเอง`;
        return `• ${dateTH} — นั่งกับอ. ${r.supervisor_name || '(ยังไม่ระบุอาจารย์)'}`;
      })
      .join('\n');
    return fill(await getTemplate('bot_opd_calendar_block', db), { opd_lines: lines });
  } catch {
    return '';
  }
}

function wardToCodeForElective(ward) {
  const w = String(ward || '').trim();
  if (!w) return '';
  if (w.includes('ชาย')) return 'male';
  if (w.includes('หญิง')) return 'female';
  if (w.toLowerCase().includes('male')) return 'male';
  if (w.toLowerCase().includes('female')) return 'female';
  return '';
}

const _NAME_PREFIX_REPLY = [
  'นพ.', 'นพ ', 'พญ.', 'พญ ', 'คุณหมอ', 'หมอ',
  'Dr.', 'Dr ', 'dr.', 'dr ', 'นายแพทย์', 'แพทย์หญิง',
];
function normalizeNameForEnglishReply(text) {
  if (!text) return '';
  let s = String(text).trim();
  for (const p of _NAME_PREFIX_REPLY) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** พิมพ์ข้อความขึ้นต้นด้วย Latin หรือ elective มี name_en / ชื่อหลักเป็นภาษาอังกฤษ → ตอบเทมเพลต EN */
export function electiveUsesEnglishReply(elective, userQueryText = '') {
  const q = String(userQueryText || '').trim();
  if (q.length >= 2 && /^[A-Za-z]/.test(q)) return true;
  if (!elective) return false;
  if (String(elective.name_en || '').trim()) return true;
  const n = normalizeNameForEnglishReply(elective.name || '');
  return n.length > 0 && /^[A-Za-z]/.test(n);
}

function parseElectiveRangeDates(rangeText) {
  const s = String(rangeText || '').trim();
  const m = s.match(/(\d{4}-\d{2}-\d{2})\s*(?:ถึง|to|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return { start: new Date(m[1]), end: new Date(m[2]) };
}

function formatEnglishElectiveRange(rangeText) {
  const r = parseElectiveRangeDates(rangeText);
  if (!r || isNaN(r.start.getTime()) || isNaN(r.end.getTime())) return '(Not specified)';
  const o = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' };
  return `${r.start.toLocaleDateString('en-GB', o)} – ${r.end.toLocaleDateString('en-GB', o)}`;
}

function formatWardEn(ward) {
  if (!ward || !String(ward).trim()) return '(Not specified)';
  return String(ward).replace(/วอร์ดชาย/g, 'Male Ward').replace(/วอร์ดหญิง/g, 'Female Ward');
}

function displayLineForEn(line) {
  const s = String(line || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('@') ? s : `@${s}`;
}

async function buildChiefDetailEn(chief, db) {
  const detailTpl = await getTemplate('bot_elective_chief_detail_en', db);
  const name = await getChiefNameEn(chief, db);
  const lineRaw = String(chief?.chief_line_id || '').trim();
  let lineBlock = '';
  if (lineRaw) {
    lineBlock = fill(await getTemplate('bot_elective_chief_line_en', db), {
      line_display: displayLineForEn(lineRaw),
    });
  }
  const sup = String(chief?.supervise_list || '').trim();
  let attendingBlock = '';
  if (sup) {
    attendingBlock = fill(await getTemplate('bot_elective_chief_attending_en', db), {
      supervise_list: sup,
    });
  }
  return fill(detailTpl, {
    chief_name: name,
    line_block: lineBlock,
    attending_block: attendingBlock,
  });
}

async function getChiefNameEn(chief, db) {
  const chiefName = String(chief?.chief_name || '').trim();
  if (!chiefName) return '—';
  if (/^[A-Za-z]/.test(chiefName)) return chiefName;
  try {
    const { rows } = await db.execute({
      sql: `SELECT ifnull(name_en, '') AS name_en
            FROM chief_residents
            WHERE trim(name)=trim(?)
            LIMIT 1`,
      args: [chiefName],
    });
    const chiefNameEn = String(rows[0]?.name_en || '').trim();
    return chiefNameEn || chiefName;
  } catch {
    return chiefName;
  }
}

export async function buildElectiveOPDBlockEn(elective, db) {
  try {
    if (!elective?.id) return '';
    const { rows } = await db.execute({
      sql: `SELECT oc.date, oc.opd_mode, s.name as supervisor_name, ifnull(s.name_en,'') as supervisor_name_en
            FROM opd_calendar oc
            LEFT JOIN supervisors s ON s.id = oc.supervisor_id
            WHERE oc.date >= date('now')
              AND oc.elective_ids LIKE ?
            ORDER BY oc.date
            LIMIT 10`,
      args: [`%${elective.id}%`],
    });
    if (!rows.length) return '';
    const tplSolo = await getTemplate('bot_opd_calendar_line_solo_en', db);
    const tplWith = await getTemplate('bot_opd_calendar_line_with_en', db);
    const lines = rows.map(r => {
      const d = new Date(`${r.date}T12:00:00`);
      const dateEn = d.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
      });
      const mode = (r.opd_mode || '').toLowerCase();
      if (mode === 'solo') {
        return fill(tplSolo, { date_en: dateEn });
      }
      const sup = (r.supervisor_name_en || '').trim() || r.supervisor_name || 'supervisor';
      return fill(tplWith, { date_en: dateEn, supervisor: sup });
    });
    return fill(await getTemplate('bot_opd_calendar_block_en', db), {
      opd_lines_en: lines.join('\n'),
    });
  } catch {
    return '';
  }
}

async function buildElectiveReplyMessageEn(elective, db, chiefMonthYyyyMm = null) {
  const month =
    chiefMonthYyyyMm ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const chiefs = await getChiefsForMonth(db, month);
  const w1 = wardToCodeForElective(elective.ward);
  const w2 = wardToCodeForElective(elective.ward2);
  const c1 = w1 ? chiefs[w1] : null;
  const c2 = w2 ? chiefs[w2] : null;

  const displayName =
    String(elective.name_en || '').trim() || String(elective.name || '').trim() || '—';

  const chiefDetail1 = await buildChiefDetailEn(c1, db);
  const period1_block_en = fill(await getTemplate('bot_elective_period1_block_en', db), {
    period1_dates_en: formatEnglishElectiveRange(elective.date_range),
    ward1_en: formatWardEn(elective.ward),
    chief_detail1: chiefDetail1,
  });

  let period2_block_en = '';
  if (String(elective.date_range2 || '').trim() && String(elective.ward2 || '').trim()) {
    period2_block_en = fill(await getTemplate('bot_elective_period2_block_en', db), {
      period2_dates_en: formatEnglishElectiveRange(elective.date_range2),
      ward2_en: formatWardEn(elective.ward2),
      chief_detail2: await buildChiefDetailEn(c2, db),
    });
  }

  const opdBlock = await buildElectiveOPDBlockEn(elective, db);
  const opd_section_en = opdBlock ? `\n${opdBlock}\n` : '\n';

  const closing_wish = await getTemplate('bot_elective_closing_en', db);
  const pdf = (await getSetting('pdf_manual_url', db)).trim() || '(Not configured)';
  const calRaw = (await getSetting('elective_calendar_url', db)).trim();
  const elective_calendar_url = calRaw || ELECTIVE_CALENDAR_URL_DEFAULT;

  const tpl = await getTemplate('bot_elective_reply_en', db);
  return fill(tpl, {
    display_name: displayName,
    level: elective.level || '—',
    period1_block_en,
    period2_block_en,
    opd_section_en,
    closing_wish,
    pdf_manual_url: pdf,
    elective_calendar_url,
  });
}

/**
 * @param {object} elective row from electives
 * @param {object} db
 * @param {string|null} chiefMonthYyyyMm เดือนของ Chief ในปฏิทิน (เช่น จาก state.month) — ถ้า null ใช้เดือนปัจจุบันตาม Asia/Bangkok
 * @param {string} userQueryText ข้อความที่ผู้ใช้พิมพ์ (LINE / preview) — ขึ้นต้นด้วย A–Z จะเลือกเทมเพลตภาษาอังกฤษ
 */
export async function buildElectiveReplyMessage(elective, db, chiefMonthYyyyMm = null, userQueryText = '') {
  if (electiveUsesEnglishReply(elective, userQueryText)) {
    return buildElectiveReplyMessageEn(elective, db, chiefMonthYyyyMm);
  }
  const tpl = await getTemplate('bot_elective_reply', db);
  const month =
    chiefMonthYyyyMm ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const chiefs = await getChiefsForMonth(db, month);

  const fmtLine = line => {
    const s = String(line || '').trim();
    if (!s) return '';
    return s.startsWith('@') || s.startsWith('http') ? s : `@${s}`;
  };

  const ward1Code = wardToCodeForElective(elective.ward);
  const ward2Code = wardToCodeForElective(elective.ward2);
  const c1 = ward1Code ? chiefs[ward1Code] : null;
  const c2 = ward2Code ? chiefs[ward2Code] : null;

  const chief1Line = fmtLine(c1?.chief_line_id);
  const chief2Line = fmtLine(c2?.chief_line_id);

  const data = {
    name: elective.name || '',
    level: elective.level || '',
    period1_dates: formatThaiRange(elective.date_range) || '(ยังไม่ระบุ)',
    ward1: elective.ward || '(ยังไม่ระบุ)',
    period2_dates: formatThaiRange(elective.date_range2) || '',
    ward2: elective.ward2 || '',
    pdf_manual_url: (await getSetting('pdf_manual_url', db)) || '(ยังไม่ตั้งค่า)',
    chief1_name: c1?.chief_name || '',
    chief1_line: chief1Line || '',
    supervise1_list: c1?.supervise_list || '',
    chief2_name: c2?.chief_name || '',
    chief2_line: chief2Line || '',
    supervise2_list: c2?.supervise_list || '',
  };

  data.period1_block = fill(await getTemplate('bot_elective_period1_block', db), data);
  data.period2_block =
    data.period2_dates && data.ward2
      ? fill(await getTemplate('bot_elective_period2_block', db), data)
      : '';
  data.opd_block = await buildElectiveOPDBlock(elective, db);

  return fill(tpl, data);
}

export async function buildOPDBlock(doctor, data, db) {
  try {
    const { rows } = await db.execute({
      sql: `SELECT oc.*, s.name as supervisor_name
            FROM opd_calendar oc
            LEFT JOIN supervisors s ON s.id = oc.supervisor_id
            WHERE oc.date >= date('now')
            AND oc.elective_ids LIKE ?
            ORDER BY oc.date LIMIT 10`,
      args: [`%${doctor.id}%`],
    });
    if (rows.length > 0) {
      const lines = rows
        .map(r => `• ${r.date} — ${r.supervisor_name || ''} (${r.opd_mode || ''})`)
        .join('\n');
      return fill(await getTemplate('bot_opd_calendar_block', db), { opd_lines: lines });
    }
  } catch { /* fallback */ }

  if (data.opd_schedule && data.opd_schedule !== '(ยังไม่ระบุ)') {
    return fill(await getTemplate('bot_opd_fallback_block', db), data);
  }
  return '🏥 OPD: (ยังไม่มีตาราง — ดูที่ประกาศในกลุ่ม)';
}

export async function buildWelcomeMessage(doctor, db) {
  const tpl = await getTemplate('bot_welcome', db);

  const dat = {
    name: doctor.name || '',
    type: doctor.type || '',
    period1_dates: doctor.period1_dates || '(ยังไม่ระบุ)',
    ward1: doctor.ward1 || '(ยังไม่ระบุ)',
    period2_dates: doctor.period2_dates || '',
    ward2: doctor.ward2 || '',
    chief1_name: doctor.chief1_name || '(ยังไม่ระบุ)',
    chief1_link: doctor.chief1_link || '(ยังไม่ระบุ)',
    chief2_name: doctor.chief2_name || '',
    chief2_link: doctor.chief2_link || '',
    opd_schedule: doctor.opd_schedule || '(ยังไม่ระบุ)',
    opd_role: doctor.opd_role || '(ยังไม่ระบุ)',
    pdf_manual_url: (await getSetting('pdf_manual_url', db)) || '(ยังไม่ตั้งค่า)',
  };

  dat.period2_block =
    dat.period2_dates && dat.ward2
      ? fill(await getTemplate('bot_period2_block', db), dat)
      : '';

  let chiefBlock = fill(await getTemplate('bot_chief_block', db), dat);
  if (dat.chief2_name && dat.chief2_link && dat.chief2_name !== dat.chief1_name) {
    chiefBlock += fill(await getTemplate('bot_chief2_block', db), dat);
  }
  dat.chief_block = chiefBlock;
  dat.opd_block = await buildOPDBlock(doctor, dat, db);

  return fill(tpl, dat);
}
