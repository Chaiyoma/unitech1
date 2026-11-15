import { fileURLToPath } from 'node:url';
import { openDb, tx } from './db.js';
import { hashPassword, tempPassword } from './security.js';

const T = Date.now();
const SESSION_NOW = '2026/2027';
const SESSION_PREV = '2025/2026';

/** Fill an empty database with realistic sample data. Every account must change its password at first sign-in. */
export async function seedDemo(db, password) {
  const hash = await hashPassword(password);
  const user = (role, login_id, name, department, level, email) =>
    Number(db.prepare(`INSERT INTO users (role, login_id, name, email, pw_hash, must_change_pw, department, level, created_at)
      VALUES (?,?,?,?,?,1,?,?,?)`).run(role, login_id, name, email, hash, department, level, T).lastInsertRowid);

  return tx(db, () => {
    const admin = user('admin', 'ADM/0001', 'Registry Office', null, null, 'registry@unitech.example');
    const l1 = user('lecturer', 'STF/0001', 'Dr. Ngozi Amadi', 'Computer Science', null, 'n.amadi@unitech.example');
    const l2 = user('lecturer', 'STF/0002', 'Engr. Tamuno Briggs', 'Computer Science', null, 't.briggs@unitech.example');
    const l3 = user('lecturer', 'STF/0003', 'Prof. Emeka Wike', 'Computer Science', null, 'e.wike@unitech.example');
    const s1 = user('student', 'UT/2025/CSC/0001', 'Adaeze Okonkwo', 'Computer Science', 200, 'adaeze@student.unitech.example');
    const s2 = user('student', 'UT/2025/CSC/0002', 'Tonye Harry', 'Computer Science', 200, 'tonye@student.unitech.example');
    const s3 = user('student', 'UT/2025/CSC/0003', 'Blessing Eze', 'Computer Science', 200, 'blessing@student.unitech.example');

    const course = (code, title, units, level, session, sem, lec, day, start, end, venue) =>
      Number(db.prepare(`INSERT INTO courses (code, title, units, department, level, session, semester, lecturer_id, day, start, end, venue)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, title, units, 'Computer Science', level, session, sem, lec, day, start, end, venue).lastInsertRowid);

    // Last session (100 Level) — has results
    const prev = [
      course('CSC 101', 'Introduction to Computer Science', 3, 100, SESSION_PREV, 1, l1, null, null, null, null),
      course('MTH 101', 'General Mathematics I', 3, 100, SESSION_PREV, 1, l2, null, null, null, null),
      course('GST 101', 'Use of English', 2, 100, SESSION_PREV, 1, l3, null, null, null, null),
      course('CSC 102', 'Introduction to Programming', 3, 100, SESSION_PREV, 2, l2, null, null, null, null),
    ];
    const scores = { [s1]: [78, 66, 71, 83], [s2]: [58, 49, 62, 55], [s3]: [64, 72, 59, 68] };
    const en = db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)');
    const rs = db.prepare('INSERT INTO results (student_id, course_id, score, updated_at) VALUES (?,?,?,?)');
    for (const [sid, arr] of Object.entries(scores)) prev.forEach((cid, i) => { en.run(Number(sid), cid); rs.run(Number(sid), cid, arr[i], T); });

    // This semester (200 Level) — open for registration
    const now = [
      course('CSC 201', 'Data Structures and Algorithms', 3, 200, SESSION_NOW, 1, l1, 1, '08:00', '10:00', 'Lecture Hall A'),
      course('CSC 203', 'Computer Architecture', 3, 200, SESSION_NOW, 1, l2, 2, '10:00', '12:00', 'ICT Lab 2'),
      course('CSC 205', 'Database Systems', 3, 200, SESSION_NOW, 1, l1, 3, '12:00', '14:00', 'Lecture Hall B'),
      course('MTH 201', 'Linear Algebra', 3, 200, SESSION_NOW, 1, l3, 4, '08:00', '10:00', 'Science Block 1'),
      course('STA 201', 'Probability and Statistics', 3, 200, SESSION_NOW, 1, l3, 5, '10:00', '12:00', 'Lecture Hall A'),
      course('GST 201', 'Entrepreneurship Studies', 2, 200, SESSION_NOW, 1, l2, 3, '08:00', '10:00', 'Auditorium'),
    ];
    [now[0], now[1], now[2], now[3]].forEach((cid) => en.run(s1, cid));
    [now[0], now[1]].forEach((cid) => en.run(s2, cid));
    now.slice(0, 3).forEach((cid) => en.run(s3, cid));

    const inv = db.prepare('INSERT INTO invoices (student_id, title, amount_kobo, due, paid_at, receipt) VALUES (?,?,?,?,?,?)');
    inv.run(s1, 'School fees 2026/2027', 185_000_00, '2026-12-15', null, null);
    inv.run(s1, 'Hostel accommodation', 60_000_00, '2026-12-15', null, null);
    inv.run(s1, 'Acceptance fee 2025/2026', 50_000_00, null, T - 86400000 * 200, 'RCP-A1B2C3');
    inv.run(s2, 'School fees 2026/2027', 185_000_00, '2026-12-15', T - 86400000 * 5, 'RCP-D4E5F6');
    inv.run(s3, 'School fees 2026/2027', 185_000_00, '2026-12-15', null, null);

    const an = db.prepare('INSERT INTO announcements (title, body, author_id, audience, created_at) VALUES (?,?,?,?,?)');
    an.run('Course registration is open', 'Please register your courses for the 2026/2027 first semester before 30 November. Maximum 24 units.', admin, 'student', T - 86400000 * 3);
    an.run('Harmattan break notice', 'Lectures will pause from 19 December and resume on 11 January. Exams follow in February.', admin, 'all', T - 86400000 * 2);
    an.run('Staff meeting on Friday', 'All lecturers: department meeting at 2pm in the Senate Room.', admin, 'lecturer', T - 86400000);
    return { admin, lecturers: [l1, l2, l3], students: [s1, s2, s3] };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
    console.error('Database already has users — refusing to seed. Delete data/unitech.db to start over.');
    process.exit(1);
  }
  const pw = process.env.DEMO_PASSWORD || tempPassword();
  await seedDemo(db, pw);
  console.log('\nDemo accounts created. Everyone must choose a new password at first sign-in.\n');
  console.log('  Student   UT/2025/CSC/0001  (Adaeze Okonkwo)');
  console.log('  Lecturer  STF/0001          (Dr. Ngozi Amadi)');
  console.log('  Admin     ADM/0001');
  console.log(`\n  Temporary password for all: ${pw}\n`);
}
