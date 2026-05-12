/**
 * apiRouter.js
 * เทียบเท่า switch(action) ใน doGet() + doPost() ของ Code.gs
 * แต่เปลี่ยนจาก URL params → JSON body + JWT auth
 */

import { verifyToken, signToken } from './auth.js';
import { findDoctorByName } from './fuzzyMatch.js';
import { buildElectiveReplyMessage } from './lineTemplates.js';

/** ค่าตั้งต้นสำหรับ OA @893tgcjb — ใช้เมื่อใน DB ยังว่าง */
const LINE_OA_DEFAULT_SHEET =
  'https://docs.google.com/spreadsheets/d/13x5NRqZVQMG59u34pTxLSRx0i9akduFcdLUquB7BAPw/edit?gid=0#gid=0';
const LINE_OA_DEFAULT_ADD_FRIEND = 'https://line.me/R/ti/p/@893tgcjb';

export const router = {

  // ── GET /api/... ────────────────────────────────────────
  async handleGet(request, db, env) {
    const url    = new URL(request.url);
    const action = (url.searchParams.get('action') || '').trim();
    const month  = url.searchParams.get('month') || currentMonth();

    // ── Public read-only (ไม่ต้อง auth) ──────────────────────
    if (action === 'calendar' && url.searchParams.get('public_view') === '1') {
      const enabled = await getSetting('calendar_public_view', db);
      if (enabled === 'FALSE') return fail('Public viewer is disabled');
      return ok({ user: { role: 'viewer' }, data: await getCalendar(month, db) });
    }
    if (action === 'public_settings') {
      return ok({ data: await getPublicSettings(db, env) });
    }
    if (action === 'supervisors') {
      return ok({ data: await getSupervisors(db) });
    }
    if (action === 'electives') {
      return ok({ data: await getElectives(url.searchParams.get('status'), db) });
    }
    if (action === 'chiefs') {
      return ok({ data: await getChiefs(month, db) });
    }
    if (action === 'chief_residents') {
      return ok({ data: await getChiefResidents(db) });
    }
    if (action === 'search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return ok({ data: [] });
      const { rows } = await db.execute({
        sql: `SELECT * FROM doctors WHERE status IN ('active','upcoming')
              AND (name LIKE ? OR type LIKE ?) ORDER BY name LIMIT 20`,
        args: [`%${q}%`, `%${q}%`],
      });
      return ok({ data: rows });
    }
    if (action === 'elective_preview') {
      return await runElectivePreview(url.searchParams, db);
    }
    if (action === 'holidays') {
      return ok({ data: await getHolidays(month, db) });
    }

    const user = await authFromHeader(request, env);
    if (!user) return fail('Unauthorized', 401);

    switch (action) {
      case 'calendar':
        return ok({ user: safe(user), data: await getCalendar(month, db) });
      case 'doctors':
        return ok({ data: await getDoctors(db) });
      case 'users':
        if (!can(user, 'admin')) return fail('Admin only');
        return ok({ data: await getUsers(db) });
      case 'templates':
        if (!can(user, 'editor')) return fail('Permission denied');
        return ok({ data: await getTemplates(db) });
      case 'settings':
        if (!can(user, 'admin')) return fail('Admin only');
        return ok({ data: await getSettings(db) });
      case 'elective_stats':
        return ok({ data: await getElectiveStats(db) });
      case 'archive_preview':
        if (!can(user, 'admin')) return fail('Admin only');
        return ok({ data: await archivePreview(url.searchParams.get('target_month'), db) });
      case 'line_oa_settings':
        if (!can(user, 'editor')) return fail('Permission denied');
        return ok({ data: await getLineOaSettings(db) });
      case 'elective_preview':
        return await runElectivePreview(url.searchParams, db);
      default:
        return fail('Unknown action');
    }
  },

  // ── POST /api/... ───────────────────────────────────────
  async handlePost(request, data, db, env) {
    const { action } = data;

    // liff_login — LIFF เรียกตรวจสิทธิ์ด้วย LINE userId (ไม่ต้อง PIN)
    if (action === 'liff_login') {
      const { lineUserId, displayName } = data;
      if (!lineUserId) return fail('lineUserId required');
      const { rows } = await db.execute({
        sql: `SELECT role, name FROM liff_admins WHERE line_user_id=? AND active=1`,
        args: [lineUserId],
      });
      if (!rows[0]) {
        await db.execute({
          sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','liff_login_denied',?,?)`,
          args: [displayName || lineUserId, JSON.stringify({ lineUserId })],
        });
        return fail('ไม่มีสิทธิ์', 403);
      }
      const adminUser = {
        id: `LIFF_${lineUserId.slice(-8)}`,
        name: rows[0].name || displayName || 'Admin',
        role: rows[0].role || 'editor',
      };
      const token = await signToken(adminUser, env.JWT_SECRET);
      await db.execute({
        sql: `INSERT INTO logs(level,fn,message,meta) VALUES('INFO','liff_login_ok',?,?)`,
        args: [adminUser.name, JSON.stringify({ lineUserId, role: adminUser.role })],
      });
      return ok({ user: adminUser, token });
    }

    // verify_login — ไม่ต้อง token
    if (action === 'verify_login') {
      if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 8) {
        return fail(
          'JWT_SECRET ยังไม่ได้ตั้งใน Worker (Cloudflare → Variables → เพิ่ม Secret JWT_SECRET)',
          503
        );
      }
      const user = await verifyUser(data.name, data.pin, db);
      if (!user) return fail('ชื่อหรือ PIN ไม่ถูกต้อง');
      const token = await signToken(user, env.JWT_SECRET);
      return ok({ user: safe(user), token });
    }

    // ── ทุก action อื่น ต้อง auth ──
    const user = await authFromHeader(request, env);
    if (!user) return fail('Unauthorized', 401);

    switch (action) {
      case 'save_opd':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveOPD({ ...data.data, created_by: user.name }, db));
      case 'delete_opd':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteOPD(data.id, db));
      case 'save_elective':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveElective(data.data, db));
      case 'delete_elective':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteElective(data.id, db));
      case 'soft_delete_elective':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await softDeleteElective(data.id, db));
      case 'hard_delete_elective':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await hardDeleteElective(data.id, db));
      case 'save_chief_resident':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveChiefResident(data.data, db));
      case 'delete_chief_resident':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteChiefResident(data.id, db));
      case 'save_supervisor':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveSupervisor(data.data, db));
      case 'delete_supervisor':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteSupervisor(data.id, db));
      case 'save_chief':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveChief(data.data, db));
      case 'save_doctor':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveDoctor(data.data, db));
      case 'delete_doctor':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteDoctor(data.id, db));
      case 'save_user':
        if (!can(user,'admin')) return fail('Admin only');
        return ok(await saveUser(data.data, db));
      case 'delete_user':
        if (!can(user,'admin')) return fail('Admin only');
        return ok(await deleteUser(data.id, db));
      case 'get_users':
        if (!can(user,'admin')) return fail('Admin only');
        return ok({ data: await getUsers(db) });
      case 'change_pin':
        return ok(await changePin(user.id, data.old_pin, data.new_pin, db));
      case 'save_templates':
        if (!can(user, 'editor')) return fail('Permission denied');
        return ok(
          await saveTemplates(data.templates, data.pdf_manual_url, data.elective_calendar_url, db, {
            line_oa_sheet_url: data.line_oa_sheet_url,
            line_oa_add_friend_url: data.line_oa_add_friend_url,
          })
        );
      case 'save_holiday':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await saveHoliday(data.data, user.name, db));
      case 'delete_holiday':
        if (!can(user,'editor')) return fail('Permission denied');
        return ok(await deleteHoliday(data.id, db));
      case 'archive_and_delete_month':
        if (!can(user,'admin')) return fail('Admin only');
        return ok(await archiveAndDeleteMonth(data.target_month, db));
      case 'save_line_oa_settings':
        if (!can(user, 'editor')) return fail('Permission denied');
        return ok(await saveLineOaSettings(data.line_oa || data, db));
      default:
        return fail('Unknown action: ' + action);
    }
  },
};

// ── Auth helpers ────────────────────────────────────────────
async function authFromHeader(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyToken(token, env.JWT_SECRET);
}

async function verifyUser(name, pin, db) {
  const { rows } = await db.execute({
    sql: `SELECT * FROM users WHERE name=? AND pin=? AND active=1`,
    args: [name, pin],
  });
  return rows[0] || null;
}

const ROLE_LEVEL = { viewer: 1, editor: 2, admin: 3 };
function can(user, required) {
  return (ROLE_LEVEL[user?.role] || 0) >= (ROLE_LEVEL[required] || 99);
}
function safe(u) { return { id: u.id, name: u.name, role: u.role }; }
function ok(data, status = 200)  { return { success: true, status, ...data }; }
function fail(error, status = 400) { return { success: false, status, error }; }
function currentMonth() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

async function runElectivePreview(searchParams, db) {
  const qIn = (searchParams.get('q') || '').trim();
  const chiefMonth =
    searchParams.get('month') || searchParams.get('chief_month') || currentMonth();
  const words = qIn.split(/\s+/).filter(Boolean);
  if (qIn.length < 2) return ok({ elective_preview: { hint: 'short' } });
  const latinOneWordOk =
    /^[A-Za-z]/.test(qIn) &&
    !/[ก-๙]/.test(qIn) &&
    qIn.replace(/\s+/g, '').length >= 4;
  if (words.length < 2 && !latinOneWordOk) {
    return ok({
      elective_preview: {
        hint: 'need_full_name',
        message: 'กรุณาพิมพ์ "ชื่อ นามสกุล" ให้ครบ เหมือนส่งข้อความใน LINE เพื่อดูข้อมูลตารางค่ะ',
      },
    });
  }
  const threshold = parseInt((await getSetting('fuzzy_threshold', db)) || '90', 10) || 90;
  const { rows: electives } = await db.execute(
    `SELECT * FROM electives WHERE status IS NULL OR status != 'deleted' ORDER BY name`
  );
  const eMatch = findDoctorByName(qIn, electives, threshold);
  if (!eMatch?.doctor) {
    const first = words[0] || qIn;
    const like = `%${first}%`;
    const { rows: suggestions } = await db.execute({
      sql: `SELECT id, name, level, date_range FROM electives
            WHERE (status IS NULL OR status != 'deleted')
              AND (name LIKE ? OR ifnull(name_en,'') LIKE ?)
            ORDER BY name LIMIT 10`,
      args: [like, like],
    });
    return ok({ elective_preview: { match: false, suggestions: suggestions || [] } });
  }
  const text = await buildElectiveReplyMessage(eMatch.doctor, db, chiefMonth, qIn);
  return ok({
    elective_preview: {
      match: true, text,
      similarity: eMatch.similarity,
      elective: {
        id: eMatch.doctor.id,
        name: eMatch.doctor.name,
        name_en: eMatch.doctor.name_en || '',
        level: eMatch.doctor.level,
      },
    },
  });
}

// ── DB helpers ─────────────────────────────────────────────
async function getSetting(key, db) {
  const { rows } = await db.execute({ sql:`SELECT value FROM settings WHERE key=?`, args:[key] });
  return rows[0]?.value || '';
}
async function getLineOaSettings(db) {
  const welcome = await getSetting('line_oa_welcome', db);
  const sheetRaw = await getSetting('line_oa_sheet_url', db);
  const friendRaw = await getSetting('line_oa_add_friend_url', db);
  return {
    welcome,
    sheet_url: sheetRaw || LINE_OA_DEFAULT_SHEET,
    add_friend_url: friendRaw || LINE_OA_DEFAULT_ADD_FRIEND,
  };
}
async function saveLineOaSettings(payload, db) {
  const p = payload || {};
  const pairs = [];
  if (Object.prototype.hasOwnProperty.call(p, 'welcome')) {
    pairs.push(['line_oa_welcome', String(p.welcome ?? '')]);
  }
  if (Object.prototype.hasOwnProperty.call(p, 'sheet_url')) {
    pairs.push(['line_oa_sheet_url', String(p.sheet_url ?? '')]);
  }
  if (Object.prototype.hasOwnProperty.call(p, 'add_friend_url')) {
    pairs.push(['line_oa_add_friend_url', String(p.add_friend_url ?? '')]);
  }
  for (const [key, val] of pairs) {
    await db.execute({
      sql: `INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [key, val],
    });
  }
  return { success: true };
}
async function getPublicSettings(db, env) {
  const keys = ['pdf_manual_url', 'elective_calendar_url', 'calendar_public_view'];
  const result = [];
  for (const key of keys) result.push({ key, value: await getSetting(key, db) });
  const lo = await getLineOaSettings(db);
  result.push({ key: 'line_oa_welcome', value: lo.welcome });
  result.push({ key: 'line_oa_sheet_url', value: lo.sheet_url });
  result.push({ key: 'line_oa_add_friend_url', value: lo.add_friend_url });
  const liffId = typeof env?.LIFF_ID === 'string' ? env.LIFF_ID.trim() : '';
  result.push({ key: 'liff_id', value: liffId });
  return result;
}
async function getCalendar(month, db) {
  const { rows } = await db.execute({
    sql: `SELECT oc.*, s.name as supervisor_name, ifnull(s.name_en,'') as supervisor_name_en
          FROM opd_calendar oc
          LEFT JOIN supervisors s ON s.id = oc.supervisor_id
          WHERE strftime('%Y-%m', oc.date) = ? ORDER BY oc.date`,
    args: [month],
  });
  return rows;
}
async function getSupervisors(db) {
  const { rows } = await db.execute(`SELECT * FROM supervisors WHERE active=1 ORDER BY name`);
  return rows;
}
async function getElectives(status, db) {
  const sql = status
    ? `SELECT * FROM electives WHERE status=? ORDER BY name`
    : `SELECT * FROM electives WHERE status IS NULL OR status != 'deleted' ORDER BY name`;
  const { rows } = await db.execute({ sql, args: status ? [status] : [] });
  return rows;
}
async function getChiefs(month, db) {
  const { rows } = await db.execute({
    sql: `SELECT * FROM chiefs WHERE month=? ORDER BY ward_code`,
    args: [month],
  });
  return rows;
}
async function getUsers(db) {
  const { rows } = await db.execute(`SELECT id, name, role, active FROM users ORDER BY name`);
  return rows;
}
async function getDoctors(db) {
  const { rows } = await db.execute(`SELECT * FROM doctors WHERE status NOT IN ('deleted') ORDER BY name`);
  return rows;
}
async function getChiefResidents(db) {
  const { rows } = await db.execute(`SELECT * FROM chief_residents WHERE active=1 ORDER BY name`);
  return rows;
}
async function saveChiefResident(data, db) {
  const id = data.id || `CR${Date.now()}`;
  const newName = data.name;
  const newLine = data.line_id || '';
  const newRole = data.role || 'Resident 3';
  // ── Read existing row (if any) to know the OLD name — needed to find matching chiefs rows
  let oldName = '';
  if (data.id) {
    const { rows } = await db.execute({
      sql: `SELECT name FROM chief_residents WHERE id=?`,
      args: [data.id],
    });
    oldName = rows[0]?.name || '';
  }
  const newNameEn = data.name_en != null ? String(data.name_en) : '';
  await db.execute({
    sql: `INSERT INTO chief_residents(id,name,role,line_id,name_en,active) VALUES(?,?,?,?,?,1)
          ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, role=excluded.role, line_id=excluded.line_id, name_en=excluded.name_en`,
    args: [id, newName, newRole, newLine, newNameEn],
  });
  // ── Sync chiefs table: rows referencing old name (or new name if unchanged) get updated
  if (oldName && oldName !== newName) {
    await db.execute({
      sql: `UPDATE chiefs SET chief_name=?, chief_line_id=? WHERE chief_name=?`,
      args: [newName, newLine, oldName],
    });
  } else {
    await db.execute({
      sql: `UPDATE chiefs SET chief_line_id=? WHERE chief_name=?`,
      args: [newLine, newName],
    });
  }
  return { success: true, id };
}
async function deleteChiefResident(id, db) {
  await db.execute({ sql:`DELETE FROM chief_residents WHERE id=?`, args:[id] });
  return { success: true };
}
async function saveOPD(data, db) {
  const id = data.id || `OPD-${Date.now()}`;
  const mode = data.opd_mode || 'sit';
  const supervisorId = mode === 'solo' ? null : (data.supervisor_id || null);
  await db.execute({
    sql: `INSERT INTO opd_calendar(id,date,opd_type,supervisor_id,elective_ids,
          participant_label,notes,created_by,opd_mode,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
          date=excluded.date, opd_type=excluded.opd_type,
          supervisor_id=excluded.supervisor_id, elective_ids=excluded.elective_ids,
          participant_label=excluded.participant_label, notes=excluded.notes,
          opd_mode=excluded.opd_mode, updated_at=datetime('now')`,
    args: [id, data.date, data.opd_type || 'Elective', supervisorId,
           JSON.stringify(data.elective_ids||[]),
           data.participant_label||'', data.notes||'', data.created_by||'', mode],
  });
  return { success: true, id };
}
async function deleteOPD(id, db) {
  await db.execute({ sql:`DELETE FROM opd_calendar WHERE id=?`, args:[id] });
  return { success: true };
}
async function saveElective(data, db) {
  let id = data.id;
  if (!id) {
    const { rows } = await db.execute({
      sql: `SELECT id FROM electives
            WHERE name=? AND ifnull(level,'')=? AND ifnull(date_range,'')=? AND ifnull(date_range2,'')=?
            LIMIT 1`,
      args: [data.name, data.level || '', data.date_range || '', data.date_range2 || ''],
    });
    if (rows[0]?.id) id = rows[0].id;
  }
  if (!id) id = `E${Date.now()}`;
  const nameEn = data.name_en != null ? String(data.name_en) : '';
  await db.execute({
    sql: `INSERT INTO electives(id,name,from_hospital,level,date_range,ward,status,date_range2,ward2,name_en)
          VALUES(?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, from_hospital=excluded.from_hospital,
          level=excluded.level, date_range=excluded.date_range,
          ward=excluded.ward, status=excluded.status,
          date_range2=excluded.date_range2, ward2=excluded.ward2,
          name_en=excluded.name_en`,
    args: [id, data.name, data.from_hospital||'', data.level||'',
           data.date_range||'', data.ward||'', data.status||'upcoming',
           data.date_range2||'', data.ward2||'', nameEn],
  });
  return { success: true, id };
}
async function deleteElective(id, db) { await hardDeleteElective(id, db); return { success: true }; }
async function softDeleteElective(id, db) {
  await db.execute({ sql:`UPDATE electives SET status='deleted' WHERE id=?`, args:[id] });
  return { success: true };
}
async function hardDeleteElective(id, db) {
  await db.execute({ sql:`DELETE FROM electives WHERE id=?`, args:[id] });
  return { success: true };
}
async function saveSupervisor(data, db) {
  const id = data.id || `S${Date.now()}`;
  const supNameEn = data.name_en != null ? String(data.name_en) : '';
  await db.execute({
    sql: `INSERT INTO supervisors(id,name,active,name_en) VALUES(?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, active=excluded.active, name_en=excluded.name_en`,
    args: [id, data.name, data.active !== false ? 1 : 0, supNameEn],
  });
  return { success: true, id };
}
async function deleteSupervisor(id, db) {
  await db.execute({ sql:`UPDATE supervisors SET active=0 WHERE id=?`, args:[id] });
  return { success: true };
}
async function saveChief(data, db) {
  const id = data.id || `C${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO chiefs(id,month,ward_code,chief_name,supervise_list,chief_line_id)
          VALUES(?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
          month=excluded.month, ward_code=excluded.ward_code,
          chief_name=excluded.chief_name, supervise_list=excluded.supervise_list,
          chief_line_id=excluded.chief_line_id`,
    args: [id, data.month, data.ward_code, data.chief_name, data.supervise_list||'', data.chief_line_id||''],
  });
  return { success: true, id };
}
async function saveDoctor(data, db) {
  const id = data.id || `DR-${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO doctors(id,name,type,period1_dates,ward1,chief1_name,chief1_link,
          period2_dates,ward2,chief2_name,chief2_link,opd_schedule,opd_role,status,notes,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'upcoming',?,datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, type=excluded.type,
          period1_dates=excluded.period1_dates, ward1=excluded.ward1,
          chief1_name=excluded.chief1_name, chief1_link=excluded.chief1_link,
          period2_dates=excluded.period2_dates, ward2=excluded.ward2,
          chief2_name=excluded.chief2_name, chief2_link=excluded.chief2_link,
          opd_schedule=excluded.opd_schedule, opd_role=excluded.opd_role, notes=excluded.notes`,
    args: [id, data.name, data.type, data.period1_dates, data.ward1,
           data.chief1_name||'', data.chief1_link||'',
           data.period2_dates||'', data.ward2||'',
           data.chief2_name||'', data.chief2_link||'',
           data.opd_schedule||'', data.opd_role||'', data.notes||''],
  });
  return { success: true, id };
}
async function deleteDoctor(id, db) {
  await db.execute({ sql:`UPDATE doctors SET status='deleted' WHERE id=?`, args:[id] });
  return { success: true };
}
async function saveUser(data, db) {
  const id = data.id || `U${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO users(id,name,pin,role,active) VALUES(?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, pin=excluded.pin, role=excluded.role, active=excluded.active`,
    args: [id, data.name, data.pin, data.role||'viewer', data.active!==false?1:0],
  });
  return { success: true, id };
}
async function deleteUser(id, db) {
  await db.execute({ sql:`UPDATE users SET active=0 WHERE id=?`, args:[id] });
  return { success: true };
}
async function changePin(userId, oldPin, newPin, db) {
  const { rows } = await db.execute({ sql:`SELECT id FROM users WHERE id=? AND pin=?`, args:[userId, oldPin] });
  if (!rows[0]) return fail('PIN เดิมไม่ถูกต้อง');
  await db.execute({ sql:`UPDATE users SET pin=? WHERE id=?`, args:[newPin, userId] });
  return { success: true };
}
async function getTemplates(db) {
  const { rows } = await db.execute(`SELECT key, value, description FROM templates ORDER BY key`);
  return rows;
}
async function getSettings(db) {
  const { rows } = await db.execute(`SELECT key, value FROM settings ORDER BY key`);
  return rows;
}
async function saveTemplates(templates, pdfUrl, electiveCalendarUrl, db, lineOaExtras = {}) {
  if (templates && Array.isArray(templates)) {
    for (const t of templates) {
      await db.execute({
        sql: `INSERT INTO templates(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        args: [t.key, t.value || ''],
      });
    }
  }
  if (pdfUrl !== undefined) {
    await db.execute({
      sql: `INSERT INTO settings(key, value) VALUES('pdf_manual_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [pdfUrl || ''],
    });
  }
  if (electiveCalendarUrl !== undefined) {
    await db.execute({
      sql: `INSERT INTO settings(key, value) VALUES('elective_calendar_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [electiveCalendarUrl || ''],
    });
  }
  if (lineOaExtras.line_oa_sheet_url !== undefined) {
    await db.execute({
      sql: `INSERT INTO settings(key, value) VALUES('line_oa_sheet_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [lineOaExtras.line_oa_sheet_url || ''],
    });
  }
  if (lineOaExtras.line_oa_add_friend_url !== undefined) {
    await db.execute({
      sql: `INSERT INTO settings(key, value) VALUES('line_oa_add_friend_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      args: [lineOaExtras.line_oa_add_friend_url || ''],
    });
  }
  return { success: true };
}
async function getHolidays(month, db) {
  const { rows } = await db.execute({
    sql: `SELECT * FROM holidays WHERE strftime('%Y-%m', date) = ? ORDER BY date`,
    args: [month],
  });
  return rows;
}
async function saveHoliday(data, addedBy, db) {
  const id = data.id || `H${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO holidays(id, date, name, added_by) VALUES(?,?,?,?)
          ON CONFLICT(date) DO UPDATE SET name=excluded.name, added_by=excluded.added_by`,
    args: [id, data.date, data.name, addedBy],
  });
  const { rows } = await db.execute({ sql: `SELECT id FROM holidays WHERE date=?`, args: [data.date] });
  return { success: true, id: rows[0]?.id || id };
}
async function deleteHoliday(id, db) {
  await db.execute({ sql: `DELETE FROM holidays WHERE id=?`, args: [id] });
  return { success: true };
}
async function getElectiveStats(db) {
  const { rows } = await db.execute(`SELECT * FROM elective_stats ORDER BY month DESC LIMIT 24`);
  return rows;
}
async function archivePreview(targetMonth, db) {
  if (!targetMonth) return { count: 0, electives: [] };
  const { rows } = await db.execute(`SELECT id, name, level, from_hospital, date_range, date_range2 FROM electives`);
  const [ty, tm] = targetMonth.split('-').map(Number);
  const mEnd = new Date(ty, tm, 0);
  const matched = rows.filter(e => {
    const r = parseDateRange(e.date_range);
    const r2 = parseDateRange(e.date_range2);
    return (r && r.end <= mEnd) || (r2 && r2.end <= mEnd);
  });
  return { count: matched.length, electives: matched };
}
async function archiveAndDeleteMonth(targetMonth, db) {
  if (!targetMonth) return { success: false, error: 'ไม่ได้ระบุเดือน' };
  const { rows: electives } = await db.execute(`SELECT * FROM electives`);
  const [ty, tm] = targetMonth.split('-').map(Number);
  const mEnd = new Date(ty, tm, 0);
  const toArchive = electives.filter(e => {
    const r = parseDateRange(e.date_range);
    const r2 = parseDateRange(e.date_range2);
    const lastEnd = Math.max(r ? r.end.getTime() : 0, r2 ? r2.end.getTime() : 0);
    return lastEnd > 0 && new Date(lastEnd) <= mEnd;
  });
  if (!toArchive.length) return { success: true, deleted: 0, message: 'ไม่มี Elective ที่สิ้นสุดในเดือนนี้' };
  const byLevel = {}; const byHospital = {};
  toArchive.forEach(e => {
    byLevel[e.level||'ไม่ระบุ'] = (byLevel[e.level||'ไม่ระบุ']||0)+1;
    byHospital[e.from_hospital||'ไม่ระบุ'] = (byHospital[e.from_hospital||'ไม่ระบุ']||0)+1;
  });
  await db.execute({
    sql: `INSERT INTO elective_stats(id,month,total,by_level,by_hospital,archived_at)
          VALUES(?,?,?,?,?,datetime('now'))
          ON CONFLICT(month) DO UPDATE SET
          total=total+excluded.total, by_level=excluded.by_level,
          by_hospital=excluded.by_hospital, archived_at=excluded.archived_at`,
    args: [`ES_${targetMonth}`, targetMonth, toArchive.length, JSON.stringify(byLevel), JSON.stringify(byHospital)],
  });
  for (const e of toArchive) {
    await db.execute({ sql:`DELETE FROM opd_calendar WHERE elective_ids LIKE ?`, args:[`%${e.id}%`] });
    await db.execute({ sql:`DELETE FROM electives WHERE id=?`, args:[e.id] });
  }
  return { success: true, deleted: toArchive.length, stats_saved: true };
}
function parseDateRange(str) {
  if (!str) return null;
  const parts = str.split(/\s*(?:ถึง|to|-)\s*/);
  if (parts.length < 2) return null;
  const start = new Date(parts[0].trim());
  const end = new Date(parts[1].trim());
  if (isNaN(start) || isNaN(end)) return null;
  return { start, end };
}
