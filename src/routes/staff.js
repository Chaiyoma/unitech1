import { Router } from 'express';
import { audit, tx } from '../db.js';
import { gradeFor } from '../grades.js';
import { html, icon, csrfField, pageHead, empty, DAYS } from '../ui.js';
import { requireRole, show, intParam, clean, cleanMultiline, ip } from './common.js';
import { announcementList, announcementsFor } from './student.js';

export function staffRoutes(config) {
  const r = Router();
  const lecturer = requireRole('lecturer');
  const staff = requireRole('lecturer', 'admin');

  // ---------------- Lecturer home ----------------
  r.get('/staff', lecturer, (req, res) => {
    const courses = req.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) students,
        (SELECT COUNT(*) FROM results x WHERE x.course_id = c.id) graded
      FROM courses c WHERE c.lecturer_id = ? AND c.session = ? AND c.semester = ? ORDER BY c.code`)
      .all(req.user.id, config.session, config.semester);
    show(req, res, {
      title: 'Home', active: '/staff', body: html`
      ${pageHead(`Hello, ${req.user.name}`, 'Pick a course to see its students and enter scores.')}
      ${courses.length ? html`<div class="tiles tiles-2">${courses.map((c) => html`
        <a class="tile" href="/staff/course/${c.id}"><span class="tile-ic">${icon('book')}</span>
          <strong>${c.code} · ${c.title}</strong>
          <span class="muted">${c.students} student${c.students === 1 ? '' : 's'} registered · ${c.graded} scored</span>
          <span class="muted">${c.day ? `${DAYS[c.day]}s, ${c.start}–${c.end}` : ''}${c.venue ? ` · ${c.venue}` : ''}</span></a>`)}</div>`
        : empty('No courses assigned to you', 'When the Registry assigns you a course this semester, it will show here.')}
      <section class="card"><h2>Latest announcements</h2>${announcementList(announcementsFor(req.db, 'lecturer', 3))}</section>`,
    });
  });

  // ---------------- Enter scores ----------------
  const myCourse = (req) => {
    const id = intParam(req.params.id);
    return id && req.db.prepare('SELECT * FROM courses WHERE id = ? AND lecturer_id = ?').get(id, req.user.id);
  };
  const roster = (db, courseId) =>
    db.prepare(`SELECT u.id, u.name, u.login_id, r.score FROM enrollments e JOIN users u ON u.id = e.student_id
                LEFT JOIN results r ON r.student_id = u.id AND r.course_id = e.course_id
                WHERE e.course_id = ? ORDER BY u.name`).all(courseId);

  const coursePage = (req, res, course, errors = {}, values = {}, status = 200) => {
    const students = roster(req.db, course.id);
    show(req, res, {
      status, title: course.code, active: '/staff', wide: true, body: html`
      ${pageHead(`${course.code} · ${course.title}`, 'Type each student\'s score out of 100, then press Save. Leave blank if not ready.')}
      ${Object.keys(errors).length ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>Some scores need fixing. They are marked in red below.</span></div>` : ''}
      ${students.length ? html`<form method="post" action="/staff/course/${course.id}">${csrfField(req.session.csrf)}
        <div class="card flush"><table class="table"><thead><tr><th>Student</th><th class="hide-sm">Matric no.</th><th>Score (0–100)</th><th>Grade</th></tr></thead>
        <tbody>${students.map((s) => { const v = values[s.id] ?? s.score ?? ''; const g = v !== '' && !errors[s.id] ? gradeFor(Number(v)) : null; return html`<tr>
          <td><strong>${s.name}</strong></td><td class="hide-sm muted">${s.login_id}</td>
          <td><input class="score${errors[s.id] ? ' is-bad' : ''}" name="score_${s.id}" inputmode="numeric" maxlength="3" value="${v}" aria-label="Score for ${s.name}">
            ${errors[s.id] ? html`<small class="bad">${errors[s.id]}</small>` : ''}</td>
          <td>${g ? html`<span class="grade g-${g.letter}">${g.letter}</span>` : ''}</td></tr>`; })}</tbody></table></div>
        <div class="sticky-bar"><span class="muted">${students.length} students</span><button class="btn btn-primary" type="submit">Save scores</button></div></form>`
        : empty('No students yet', 'Students will show here after they register this course.')}`,
    });
  };

  r.get('/staff/course/:id', lecturer, (req, res) => {
    const c = myCourse(req);
    if (!c) return res.redirect('/staff');
    coursePage(req, res, c);
  });

  r.post('/staff/course/:id', lecturer, (req, res) => {
    const c = myCourse(req);
    if (!c) return res.redirect('/staff');
    const students = roster(req.db, c.id);
    const errors = {}, values = {}, ok = [];
    for (const s of students) {
      const raw = String(req.body[`score_${s.id}`] ?? '').trim();
      values[s.id] = raw;
      if (raw === '') continue;
      if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) errors[s.id] = 'Enter a whole number from 0 to 100';
      else ok.push([s.id, Number(raw)]);
    }
    if (Object.keys(errors).length) return coursePage(req, res, c, errors, values, 400);
    tx(req.db, () => {
      const up = req.db.prepare(`INSERT INTO results (student_id, course_id, score, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(student_id, course_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`);
      for (const [sid, score] of ok) up.run(sid, c.id, score, Date.now());
    });
    audit(req.db, req.user.id, 'scores_saved', `course ${c.id}, ${ok.length} scores`, ip(req));
    req.flash('ok', `Saved ${ok.length} score${ok.length === 1 ? '' : 's'}.`);
    res.redirect(`/staff/course/${c.id}`);
  });

  // ---------------- Announcements (lecturers + admin) ----------------
  const announceForm = (req, res, { error, values = {}, status = 200 } = {}) => {
    const isAdmin = req.user.role === 'admin';
    show(req, res, {
      status, title: 'Announcements', active: '/staff/announce', body: html`
      ${pageHead('Announcements', 'Write a short message for students or staff.')}
      <form class="card form" method="post" action="/staff/announce" novalidate>
        ${csrfField(req.session.csrf)}
        ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
        <div class="field"><label for="title">Title</label><input id="title" name="title" maxlength="120" value="${values.title || ''}" required></div>
        <div class="field"><label for="body">Message</label><textarea id="body" name="body" rows="5" maxlength="2000" required>${values.body || ''}</textarea></div>
        <div class="field"><label for="audience">Who should see it?</label>
          <select id="audience" name="audience">
            <option value="student">Students</option>
            ${isAdmin ? html`<option value="lecturer">Lecturers</option><option value="all">Everyone</option>` : ''}
          </select></div>
        <button class="btn btn-primary" type="submit">Post announcement</button>
      </form>
      <section class="card"><h2>Recent</h2>${announcementList(announcementsFor(req.db, isAdmin ? 'student' : 'lecturer', 5))}</section>`,
    });
  };
  r.get('/staff/announce', staff, (req, res) => announceForm(req, res));
  r.post('/staff/announce', staff, (req, res) => {
    const title = clean(req.body.title, 120);
    const body = cleanMultiline(req.body.body, 2000);
    let audience = ['student', 'lecturer', 'all'].includes(req.body.audience) ? req.body.audience : 'student';
    if (req.user.role !== 'admin') audience = 'student'; // lecturers can only write to students
    if (!title || !body) return announceForm(req, res, { error: 'Please fill in both the title and the message.', values: { title, body }, status: 400 });
    req.db.prepare('INSERT INTO announcements (title, body, author_id, audience, created_at) VALUES (?,?,?,?,?)')
      .run(title, body, req.user.id, audience, Date.now());
    audit(req.db, req.user.id, 'announcement', title, ip(req));
    req.flash('ok', 'Your announcement has been posted.');
    res.redirect('/staff/announce');
  });

  // ---------------- Profile + help (all roles) ----------------
  r.get('/profile', requireRole('student', 'lecturer', 'admin'), (req, res) => {
    const u = req.user;
    show(req, res, {
      title: 'My Profile', active: '/profile', body: html`
      ${pageHead('My Profile', 'Your details on record')}
      <div class="card narrow"><dl class="summary">
        <dt>Name</dt><dd>${u.name}</dd>
        <dt>${u.role === 'student' ? 'Matric number' : 'Staff ID'}</dt><dd>${u.login_id}</dd>
        ${u.department ? html`<dt>Department</dt><dd>${u.department}</dd>` : ''}
        ${u.level ? html`<dt>Level</dt><dd>${u.level} Level</dd>` : ''}
        ${u.email ? html`<dt>Email</dt><dd>${u.email}</dd>` : ''}
      </dl><a class="btn btn-ghost" href="/password">${icon('shield')} Change my password</a>
      <p class="muted small">Wrong details? Please tell the Registry so they can correct them.</p></div>`,
    });
  });

  r.get('/help', requireRole('student', 'lecturer', 'admin'), (req, res) => {
    const steps = [
      ['Use the menu', 'On a computer it is on the left. On a phone it is at the bottom of the screen.'],
      ['Tap a big card', 'Every card on the Home page opens one job, like checking results or paying fees.'],
      ['Look for the blue button', 'Blue buttons move you forward. Red buttons are for payments or important actions.'],
      ['Sign out when you finish', 'Especially on a shared phone or café computer. Use "Sign out" in the menu.'],
    ];
    show(req, res, {
      title: 'Help', active: '/help', body: html`
      ${pageHead('Help', 'New here? It only takes a minute to learn.')}
      <ol class="steps">${steps.map(([t, d], i) => html`<li><span class="step-n">${i + 1}</span><div><strong>${t}</strong><p class="muted">${d}</p></div></li>`)}</ol>
      <section class="card"><h2>Still stuck?</h2>
        <p>Visit the <strong>ICT Help Desk</strong>, Admin Block (Ground Floor), Monday to Friday, 8am – 4pm.</p>
        <p class="muted">Never share your password with anyone — not even school staff. We will never ask for it.</p></section>`,
    });
  });

  return r;
}
