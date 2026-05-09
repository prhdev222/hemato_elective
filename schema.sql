-- ============================================================
-- HSOS Schema สำหรับ Turso (libSQL / SQLite)
-- เทียบเท่า Google Sheets ทุก tab
-- รัน: turso db shell hsos-db < schema.sql
-- ============================================================

-- ── doctors ──────────────────────────────────────────────
-- เทียบเท่า sheet: Doctors
CREATE TABLE IF NOT EXISTS doctors (
  id             TEXT PRIMARY KEY,
  created_at     TEXT DEFAULT (datetime('now')),
  name           TEXT NOT NULL,
  type           TEXT,                    -- นศพ. / Extern / Resident / Fellow
  period1_dates  TEXT,                    -- เช่น "1-14 พ.ค. 2569"
  ward1          TEXT,                    -- วอร์ดชาย / วอร์ดหญิง
  chief1_name    TEXT,
  chief1_link    TEXT,
  period2_dates  TEXT,
  ward2          TEXT,
  chief2_name    TEXT,
  chief2_link    TEXT,
  opd_schedule   TEXT,
  opd_role       TEXT,
  status         TEXT DEFAULT 'upcoming', -- upcoming / active / completed / deleted
  status_check   TEXT DEFAULT 'not_replied', -- not_replied / replied
  replied_at     TEXT,
  notes          TEXT
);

-- ── users ─────────────────────────────────────────────────
-- เทียบเท่า sheet: Users
CREATE TABLE IF NOT EXISTS users (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  pin    TEXT NOT NULL,
  role   TEXT DEFAULT 'viewer',  -- admin / editor / viewer
  active INTEGER DEFAULT 1
);

-- ── supervisors ───────────────────────────────────────────
-- เทียบเท่า sheet: Supervisors
CREATE TABLE IF NOT EXISTS supervisors (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  active INTEGER DEFAULT 1
);

-- ── electives ────────────────────────────────────────────
-- เทียบเท่า sheet: Electives
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
-- เทียบเท่า sheet: OPD_Calendar
CREATE TABLE IF NOT EXISTS opd_calendar (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,        -- YYYY-MM-DD
  opd_type          TEXT,
  supervisor_id     TEXT REFERENCES supervisors(id),
  elective_ids      TEXT DEFAULT '[]',    -- JSON array of elective ids
  participant_label TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  opd_mode          TEXT DEFAULT 'sit'   -- sit / solo
);

-- ── chiefs ────────────────────────────────────────────────
-- เทียบเท่า sheet: Chiefs_ward
CREATE TABLE IF NOT EXISTS chiefs (
  id             TEXT PRIMARY KEY,
  month          TEXT NOT NULL,   -- YYYY-MM
  ward_code      TEXT NOT NULL,   -- male / female / opd
  chief_name     TEXT,
  supervise_list TEXT,
  chief_line_id  TEXT
);

-- ── settings ─────────────────────────────────────────────
-- เทียบเท่า sheet: Settings
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- ── templates ────────────────────────────────────────────
-- เทียบเท่า sheet: Templates
CREATE TABLE IF NOT EXISTS templates (
  key         TEXT PRIMARY KEY,
  description TEXT,
  value       TEXT
);

-- ── logs ─────────────────────────────────────────────────
-- เทียบเท่า sheet: Logs
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT DEFAULT (datetime('now')),
  level      TEXT,  -- INFO / WARN / ERROR
  fn         TEXT,
  message    TEXT,
  meta       TEXT   -- JSON
);

-- ── chief_residents ──────────────────────────────────────
-- Resident 3 / Fellow ที่เป็น Chief ของวอร์ด (แยกออกจาก electives)
CREATE TABLE IF NOT EXISTS chief_residents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'Resident 3',  -- Resident 3 / Fellow
  line_id    TEXT,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_doctors_status    ON doctors(status);
CREATE INDEX IF NOT EXISTS idx_opd_date          ON opd_calendar(date);
CREATE INDEX IF NOT EXISTS idx_chiefs_month      ON chiefs(month);
CREATE INDEX IF NOT EXISTS idx_logs_ts           ON logs(ts);

-- ── Seed: ค่าเริ่มต้น ─────────────────────────────────────
INSERT OR IGNORE INTO users(id,name,pin,role,active)
  VALUES('U001','Admin','1234','admin',1);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('bot_enabled',         'TRUE'),
  ('fuzzy_threshold',     '90'),
  ('pdf_manual_url',      ''),
  ('line_group_id',       ''),
  ('calendar_public_view','TRUE');

INSERT OR IGNORE INTO templates(key,description,value) VALUES
  ('bot_welcome',            'ข้อความต้อนรับหลัก',          ''),
  ('bot_period2_block',      'บล็อคช่วงที่ 2',              ''),
  ('bot_chief_block',        'บล็อค Chief',                 ''),
  ('bot_chief2_block',       'บล็อค Chief 2',               ''),
  ('bot_opd_calendar_block', 'บล็อค OPD จาก Calendar',      ''),
  ('bot_opd_fallback_block', 'บล็อค OPD fallback',          '');

-- ── holidays (วันหยุดที่ admin เพิ่มเอง + ยกเลิกนับวันหยุดราชการ) ───────────────────
-- name = '__opd_override__' หมายถึงเลิกนับเป็นวันนั้นเป็น holiday (ให้มี OPD ได้ กรณีฉุกเฉิน)
CREATE TABLE IF NOT EXISTS holidays (
  id    TEXT PRIMARY KEY,
  date  TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
  name  TEXT NOT NULL,
  added_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- ── elective_stats (สถิติ Elective รายเดือน) ─────────────────
CREATE TABLE IF NOT EXISTS elective_stats (
  id          TEXT PRIMARY KEY,
  month       TEXT NOT NULL UNIQUE,     -- YYYY-MM
  total       INTEGER DEFAULT 0,
  by_level    TEXT DEFAULT '{}',        -- JSON
  by_hospital TEXT DEFAULT '{}',        -- JSON
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_elective_stats_month ON elective_stats(month);
