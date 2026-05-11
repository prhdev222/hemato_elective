-- ============================================================
-- HSOS Schema สำหรับ Turso (libSQL / SQLite)
-- เทียบเท่า Google Sheets ทุก tab
-- รัน: turso db shell hsos-db < schema.sql
-- ============================================================

-- ── doctors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id             TEXT PRIMARY KEY,
  created_at     TEXT DEFAULT (datetime('now')),
  name           TEXT NOT NULL,
  type           TEXT,
  period1_dates  TEXT,
  ward1          TEXT,
  chief1_name    TEXT,
  chief1_link    TEXT,
  period2_dates  TEXT,
  ward2          TEXT,
  chief2_name    TEXT,
  chief2_link    TEXT,
  opd_schedule   TEXT,
  opd_role       TEXT,
  status         TEXT DEFAULT 'upcoming',
  status_check   TEXT DEFAULT 'not_replied',
  replied_at     TEXT,
  notes          TEXT
);

-- ── users ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  pin    TEXT NOT NULL,
  role   TEXT DEFAULT 'viewer',
  active INTEGER DEFAULT 1
);

-- ── supervisors ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervisors (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  active INTEGER DEFAULT 1
);

-- ── electives ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS electives (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  from_hospital  TEXT,
  level          TEXT,
  date_range     TEXT,
  ward           TEXT,
  line_user_id   TEXT,
  status         TEXT DEFAULT 'upcoming',
  date_range2    TEXT,
  ward2          TEXT
);

-- ── opd_calendar ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opd_calendar (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  opd_type          TEXT,
  supervisor_id     TEXT REFERENCES supervisors(id),
  elective_ids      TEXT DEFAULT '[]',
  participant_label TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  opd_mode          TEXT DEFAULT 'sit'
);

-- ── chiefs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chiefs (
  id             TEXT PRIMARY KEY,
  month          TEXT NOT NULL,
  ward_code      TEXT NOT NULL,
  chief_name     TEXT,
  supervise_list TEXT,
  chief_line_id  TEXT
);

-- ── settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- ── templates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  key         TEXT PRIMARY KEY,
  description TEXT,
  value       TEXT
);

-- ── logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT DEFAULT (datetime('now')),
  level      TEXT,
  fn         TEXT,
  message    TEXT,
  meta       TEXT
);

-- ── chief_residents ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chief_residents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'Resident 3',
  line_id    TEXT,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── liff_admins ──────────────────────────────────────────
-- อาจารย์/เลขาที่มีสิทธิ์เปิด LIFF form โดยไม่ต้องกรอก PIN
CREATE TABLE IF NOT EXISTS liff_admins (
  line_user_id  TEXT PRIMARY KEY,   -- userId จาก liff.getProfile()
  name          TEXT NOT NULL,      -- ชื่อสำหรับ log
  role          TEXT DEFAULT 'editor', -- editor | admin
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ── Index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_doctors_status    ON doctors(status);
CREATE INDEX IF NOT EXISTS idx_opd_date          ON opd_calendar(date);
CREATE INDEX IF NOT EXISTS idx_chiefs_month      ON chiefs(month);
CREATE INDEX IF NOT EXISTS idx_logs_ts           ON logs(ts);
CREATE INDEX IF NOT EXISTS idx_liff_admins_active ON liff_admins(active);

-- ── Seed: ค่าเริ่มต้น ─────────────────────────────────────
INSERT OR IGNORE INTO users(id,name,pin,role,active)
  VALUES('U001','Admin','1234','admin',1);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('bot_enabled',         'TRUE'),
  ('fuzzy_threshold',     '90'),
  ('pdf_manual_url',      ''),
  ('line_group_id',       ''),
  ('calendar_public_view','TRUE'),
  ('line_oa_welcome',     ''),
  ('line_oa_sheet_url',
   'https://docs.google.com/spreadsheets/d/13x5NRqZVQMG59u34pTxLSRx0i9akduFcdLUquB7BAPw/edit?gid=0#gid=0'),
  ('line_oa_add_friend_url', 'https://line.me/R/ti/p/@893tgcjb');

INSERT OR IGNORE INTO templates(key,description,value) VALUES
  ('bot_welcome',            'ข้อความต้อนรับหลัก',          ''),
  ('bot_period2_block',      'บล็อคช่วงที่ 2',              ''),
  ('bot_chief_block',        'บล็อค Chief',                 ''),
  ('bot_chief2_block',       'บล็อค Chief 2',               ''),
  ('bot_opd_calendar_block', 'บล็อค OPD จาก Calendar',      ''),
  ('bot_opd_fallback_block', 'บล็อค OPD fallback',          '');

-- ── holidays ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holidays (
  id    TEXT PRIMARY KEY,
  date  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  added_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- ── elective_stats ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elective_stats (
  id          TEXT PRIMARY KEY,
  month       TEXT NOT NULL UNIQUE,
  total       INTEGER DEFAULT 0,
  by_level    TEXT DEFAULT '{}',
  by_hospital TEXT DEFAULT '{}',
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_elective_stats_month ON elective_stats(month);


-- ============================================================
-- HSOS: เพิ่ม name_en column สำหรับ Bilingual Support
-- รัน: turso db shell hsos-db < add_name_en.sql
-- หรือวาง SQL นี้ใน Turso Shell โดยตรง
-- ============================================================

-- 1. electives: ชื่อแพทย์ elective (อาจเป็นชาวต่างชาติ)
ALTER TABLE electives ADD COLUMN name_en TEXT DEFAULT '';

-- 2. supervisors: ชื่ออาจารย์ที่ออก OPD
ALTER TABLE supervisors ADD COLUMN name_en TEXT DEFAULT '';

-- 3. chief_residents: Chief / Fellow
ALTER TABLE chief_residents ADD COLUMN name_en TEXT DEFAULT '';

-- ============================================================
-- ตรวจสอบหลัง ALTER
-- ============================================================
-- SELECT id, name, name_en FROM electives        LIMIT 5;
-- SELECT id, name, name_en FROM supervisors       LIMIT 5;
-- SELECT id, name, name_en FROM chief_residents   LIMIT 5;
