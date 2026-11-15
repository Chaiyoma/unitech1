import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','lecturer','admin')),
  login_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  pw_hash TEXT NOT NULL,
  must_change_pw INTEGER NOT NULL DEFAULT 1,
  department TEXT,
  level INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  flash TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 6),
  department TEXT,
  level INTEGER NOT NULL,
  session TEXT NOT NULL,
  semester INTEGER NOT NULL CHECK (semester IN (1,2)),
  lecturer_id INTEGER REFERENCES users(id),
  day INTEGER CHECK (day BETWEEN 1 AND 5),
  start TEXT,
  end TEXT,
  venue TEXT,
  UNIQUE (code, session)
);
CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, course_id)
);
CREATE TABLE IF NOT EXISTS results (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, course_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  due TEXT,
  paid_at INTEGER,
  receipt TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all','student','lecturer')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enroll_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_invoice_student ON invoices(student_id);
`;

export function openDb(file = process.env.DB_FILE || './data/unitech.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on error. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, userId, action, detail = '', ip = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, String(detail).slice(0, 300), ip, Date.now());
}
