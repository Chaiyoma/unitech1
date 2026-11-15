import { Router } from 'express';
import { randomToken } from '../security.js';
import { audit, tx } from '../db.js';
import { gradeFor, gpa, classOfDegree } from '../grades.js';
import { html, icon, csrfField, naira, fmtDate, fmtDateStr, DAYS, greeting, firstName, pageHead, empty } from '../ui.js';
import { requireRole, show, intParam, ip } from './common.js';

const MAX_UNITS = 24;

const lagosDay = () => {
  const d = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Lagos' }).format(new Date());
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 }[d] || 0;
};

const announcementsFor = (db, role, limit = 20) =>
  db.prepare(`SELECT a.*, u.name author FROM announcements a LEFT JOIN users u ON u.id = a.author_id
              WHERE a.audience IN ('all', ?) ORDER BY a.created_at DESC LIMIT ?`).all(role, limit);

export function announcementList(items) {
  return items.length
    ? html`<ul class="news">${items.map((a) => html`
        <li><div class="news-dot"></div><div><h3>${a.title}</h3>
        <p>${a.body}</p><small class="muted">${a.author || 'UniTech'} · ${fmtDate(a.created_at)}</small></div></li>`)}</ul>`
    : empty('No news yet', 'New announcements from the school will show here.');
}

export function studentRoutes(config) {
  const r = Router();
  const only = requireRole('student');

  const myCourses = (db, id) =>
    db.prepare(`SELECT c.*, l.name lecturer FROM enrollments e JOIN courses c ON c.id = e.course_id
                LEFT JOIN users l ON l.id = c.lecturer_id
                WHERE e.student_id = ? AND c.session = ? AND c.semester = ? ORDER BY c.code`)
      .all(id, config.session, config.semester);

  // ---------------- Home ----------------
  r.get('/home', only, (req, res) => {
    const { db, user } = req;
    const courses = myCourses(db, user.id);
    const owing = db.prepare('SELECT COALESCE(SUM(amount_kobo),0) t, COUNT(*) n FROM invoices WHERE student_id = ? AND paid_at IS NULL').get(user.id);
    const today = lagosDay();
    const todays = courses.filter((c) => c.day === today).sort((a, b) => a.start.localeCompare(b.start));
    const news = announcementsFor(db, 'student', 3);

    const cards = [
      ['/courses', 'book', 'My Courses', 'See and register your courses'],
      ['/results', 'chart', 'My Results', 'Check your grades and CGPA'],
      ['/fees', 'wallet', 'Pay Fees', 'See what you owe and pay'],
      ['/timetable', 'calendar', 'Timetable', 'Where and when classes hold'],
      ['/announcements', 'bell', 'News', 'Messages from the school'],
      ['/profile', 'user', 'My Profile', 'Your details and password'],
    ];
    show(req, res, {
      title: 'Home', active: '/home', body: html`
      ${pageHead(`${greeting()}, ${firstName(user.name)}`, 'What would you like to do today?')}
      ${owing.n ? html`<a class="alert-strip" href="/fees"><span>${icon('alert')}</span>
        <span><strong>You have ${naira(owing.t)} to pay.</strong> Tap here to see your fees.</span>${icon('arrow')}</a>` : ''}
      <div class="tiles">
        ${cards.map(([href, ic, t, d], i) => html`<a class="tile${href === '/fees' && owing.n ? ' tile-red' : ''}" href="${href}">
          <span class="tile-ic">${icon(ic)}</span><strong>${t}</strong><span class="muted">${d}</span></a>`)}
      </div>
      <div class="two">
        <section class="card"><h2>Today's classes</h2>
          ${todays.length ? html`<ul class="rows">${todays.map((c) => html`<li><span class="time">${c.start}</span>
            <div><strong>${c.code} · ${c.title}</strong><small class="muted">${c.venue || ''} · ${c.lecturer || ''}</small></div></li>`)}</ul>`
            : html`<p class="muted pad">${today ? 'No classes today. Enjoy your day!' : "It's the weekend — no classes today."}</p>`}
        </section>
        <section class="card"><h2>Latest news</h2>
          ${news.length ? html`<ul class="rows">${news.map((a) => html`<li><span class="dot"></span>
            <div><strong>${a.title}</strong><small class="muted">${fmtDate(a.created_at)}</small></div></li>`)}</ul>
            <a class="link" href="/announcements">See all news ${icon('arrow')}</a>` : html`<p class="muted pad">Nothing new right now.</p>`}
        </section>
      </div>`,
    });
  });

  // ---------------- Courses ----------------
  r.get('/courses', only, (req, res) => {
    const courses = myCourses(req.db, req.user.id);
    const units = courses.reduce((s, c) => s + c.units, 0);
    show(req, res, {
      title: 'My Courses', active: '/courses', body: html`
      ${pageHead('My Courses', `${config.session} session · ${config.semester === 1 ? 'First' : 'Second'} semester`,
        html`<a class="btn btn-primary" href="/courses/register">${icon('plus')} Register courses</a>`)}
      ${courses.length ? html`
        <div class="card flush"><table class="table"><thead><tr><th>Code</th><th>Course</th><th>Units</th><th class="hide-sm">Lecturer</th></tr></thead>
        <tbody>${courses.map((c) => html`<tr><td><strong>${c.code}</strong></td><td>${c.title}</td><td>${c.units}</td><td class="hide-sm">${c.lecturer || '—'}</td></tr>`)}</tbody></table></div>
        <p class="muted total">Total: <strong>${units} units</strong> (maximum ${MAX_UNITS})</p>`
        : empty('You have not registered any courses', 'Tap "Register courses" to pick your courses for this semester.',
            html`<a class="btn btn-primary" href="/courses/register">Register courses</a>`)}`,
    });
  });

  const available = (db, user) =>
    db.prepare(`SELECT c.*, l.name lecturer FROM courses c LEFT JOIN users l ON l.id = c.lecturer_id
                WHERE c.session = ? AND c.semester = ? AND c.level = ? AND (c.department IS NULL OR c.department = ?)
                ORDER BY c.code`).all(config.session, config.semester, user.level, user.department);

  const registerPage = (req, res, error, status = 200) => {
    const list = available(req.db, req.user);
    const mine = new Set(myCourses(req.db, req.user.id).map((c) => c.id));
    show(req, res, {
      status, title: 'Register courses', active: '/courses', body: html`
      ${pageHead('Register courses', 'Tick the courses you will take this semester, then press Save.')}
      ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
      ${list.length ? html`
      <form method="post" action="/courses/register" data-max="${MAX_UNITS}">
        ${csrfField(req.session.csrf)}
        <div class="card flush"><ul class="picks">${list.map((c) => html`
          <li><label class="pick"><input type="checkbox" name="course_${c.id}" data-units="${c.units}"${mine.has(c.id) ? ' checked' : ''}>
            <span class="pick-box">${icon('check')}</span>
            <span class="pick-main"><strong>${c.code} · ${c.title}</strong><small class="muted">${c.lecturer || 'Lecturer to be announced'}</small></span>
            <span class="chip">${c.units} units</span></label></li>`)}</ul></div>
        <div class="sticky-bar"><span id="unit-total" class="muted">Selected: <strong>0</strong> of ${MAX_UNITS} units</span>
          <button class="btn btn-primary" type="submit">Save my courses</button></div>
      </form>` : empty('No courses open for you yet', 'Registration for your level has not opened. Please check back soon.')}`,
    });
  };

  r.get('/courses/register', only, (req, res) => registerPage(req, res));
  r.post('/courses/register', only, (req, res) => {
    const list = available(req.db, req.user);
    const chosen = list.filter((c) => req.body[`course_${c.id}`] === 'on');
    const units = chosen.reduce((s, c) => s + c.units, 0);
    if (units > MAX_UNITS) return registerPage(req, res, `You picked ${units} units. The maximum is ${MAX_UNITS}. Please remove a course.`, 400);
    tx(req.db, () => {
      req.db.prepare(`DELETE FROM enrollments WHERE student_id = ? AND course_id IN
        (SELECT id FROM courses WHERE session = ? AND semester = ?)`).run(req.user.id, config.session, config.semester);
      const ins = req.db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)');
      for (const c of chosen) ins.run(req.user.id, c.id);
    });
    audit(req.db, req.user.id, 'register_courses', `${chosen.length} courses`, ip(req));
    req.flash('ok', `Done! You registered ${chosen.length} course${chosen.length === 1 ? '' : 's'} (${units} units).`);
    res.redirect('/courses');
  });

  // ---------------- Results ----------------
  r.get('/results', only, (req, res) => {
    const rows = req.db.prepare(`SELECT c.code, c.title, c.units, c.session, c.semester, r.score
      FROM enrollments e JOIN courses c ON c.id = e.course_id
      LEFT JOIN results r ON r.course_id = c.id AND r.student_id = e.student_id
      WHERE e.student_id = ? ORDER BY c.session DESC, c.semester DESC, c.code`).all(req.user.id);
    const cgpa = gpa(rows);
    const groups = new Map();
    for (const row of rows) {
      const k = `${row.session}|${row.semester}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
    show(req, res, {
      title: 'My Results', active: '/results', body: html`
      ${pageHead('My Results', 'Your grades for each semester')}
      ${rows.length ? html`
      <div class="stat-row">
        <div class="stat stat-blue"><small>Your CGPA</small><strong>${cgpa == null ? '—' : cgpa.toFixed(2)}</strong><span>out of 5.00</span></div>
        <div class="stat"><small>Standing</small><strong class="sm">${classOfDegree(cgpa) || '—'}</strong><span>based on results so far</span></div>
        <div class="stat"><small>Units passed</small><strong>${rows.filter((x) => x.score != null && x.score >= 40).reduce((s, x) => s + x.units, 0)}</strong><span>units</span></div>
      </div>
      ${[...groups].map(([k, items]) => { const [s, sem] = k.split('|'); const g = gpa(items); return html`
        <section class="card flush"><div class="card-head"><h2>${s} · ${sem === '1' ? 'First' : 'Second'} semester</h2>
          <span class="chip chip-blue">GPA ${g == null ? '—' : g.toFixed(2)}</span></div>
          <table class="table"><thead><tr><th>Code</th><th>Course</th><th>Units</th><th>Score</th><th>Grade</th></tr></thead>
          <tbody>${items.map((x) => { const gr = x.score == null ? null : gradeFor(x.score); return html`<tr>
            <td><strong>${x.code}</strong></td><td>${x.title}</td><td>${x.units}</td>
            <td>${x.score ?? html`<span class="muted">Pending</span>`}</td>
            <td>${gr ? html`<span class="grade g-${gr.letter}">${gr.letter}</span>` : ''}</td></tr>`; })}</tbody></table></section>`; })}
      <p class="muted small">Grading: A = 70–100 · B = 60–69 · C = 50–59 · D = 45–49 · E = 40–44 · F = below 40</p>`
        : empty('No results yet', 'Your results will appear here once your lecturers publish them.')}`,
    });
  });

  // ---------------- Fees ----------------
  r.get('/fees', only, (req, res) => {
    const inv = req.db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY paid_at IS NOT NULL, id DESC').all(req.user.id);
    const owing = inv.filter((i) => !i.paid_at).reduce((s, i) => s + i.amount_kobo, 0);
    show(req, res, {
      title: 'Pay Fees', active: '/fees', body: html`
      ${pageHead('Pay Fees', owing ? 'These fees are waiting for you.' : 'You are all paid up. Thank you!')}
      <div class="stat-row one"><div class="stat ${owing ? 'stat-red' : 'stat-blue'}"><small>Amount to pay</small>
        <strong>${naira(owing)}</strong><span>${owing ? 'Please pay before the due date' : 'Nothing owing'}</span></div></div>
      ${inv.length ? html`<div class="card flush"><ul class="bills">${inv.map((i) => html`<li>
        <div><strong>${i.title}</strong><small class="muted">${i.paid_at ? `Paid on ${fmtDate(i.paid_at)} · Receipt ${i.receipt}` : i.due ? `Due ${fmtDateStr(i.due)}` : ''}</small></div>
        <div class="bill-amt">${naira(i.amount_kobo)}</div>
        ${i.paid_at ? html`<span class="chip chip-ok">${icon('check')} Paid</span>` : html`<a class="btn btn-red" href="/fees/${i.id}/pay">Pay now</a>`}</li>`)}</ul></div>`
        : empty('No fees yet', 'Fees the school sends you will appear here.')}`,
    });
  });

  const myInvoice = (req) => {
    const id = intParam(req.params.id);
    return id && req.db.prepare('SELECT * FROM invoices WHERE id = ? AND student_id = ?').get(id, req.user.id);
  };

  r.get('/fees/:id/pay', only, (req, res) => {
    const i = myInvoice(req);
    if (!i || i.paid_at) return res.redirect('/fees');
    const demo = config.paymentMode === 'demo';
    show(req, res, {
      title: 'Confirm payment', active: '/fees', body: html`
      ${pageHead('Confirm payment', 'Please check the details, then press Pay.')}
      <div class="card narrow">
        <dl class="summary"><dt>Fee</dt><dd>${i.title}</dd><dt>Amount</dt><dd class="big">${naira(i.amount_kobo)}</dd></dl>
        ${demo ? html`<div class="flash flash-info">${icon('shield')}<span>Test mode: no real money is taken. A test receipt is created.</span></div>
          <form method="post" action="/fees/${i.id}/pay">${csrfField(req.session.csrf)}
            <button class="btn btn-red btn-block" type="submit">Pay ${naira(i.amount_kobo)}</button></form>`
          : html`<div class="flash flash-info">${icon('alert')}<span>Online payment is not open yet. Please pay at the Bursary and your receipt will show here.</span></div>`}
        <a class="btn btn-ghost btn-block" href="/fees">Go back</a>
      </div>`,
    });
  });

  r.post('/fees/:id/pay', only, (req, res) => {
    const i = myInvoice(req);
    if (!i || i.paid_at) return res.redirect('/fees');
    if (config.paymentMode !== 'demo') { req.flash('error', 'Online payment is not open yet.'); return res.redirect('/fees'); }
    const receipt = 'RCP-' + randomToken(6).toUpperCase().replace(/[-_]/g, 'X');
    req.db.prepare('UPDATE invoices SET paid_at = ?, receipt = ? WHERE id = ? AND paid_at IS NULL').run(Date.now(), receipt, i.id);
    audit(req.db, req.user.id, 'invoice_paid_demo', `invoice ${i.id}`, ip(req));
    req.flash('ok', `Payment received. Your receipt number is ${receipt}.`);
    res.redirect('/fees');
  });

  // ---------------- Timetable ----------------
  r.get('/timetable', only, (req, res) => {
    const courses = myCourses(req.db, req.user.id).filter((c) => c.day);
    show(req, res, {
      title: 'Timetable', active: '/timetable', body: html`
      ${pageHead('Timetable', 'Your classes for this semester')}
      ${courses.length ? html`<div class="week">${[1, 2, 3, 4, 5].map((d) => {
        const items = courses.filter((c) => c.day === d).sort((a, b) => a.start.localeCompare(b.start));
        return html`<section class="day${d === lagosDay() ? ' is-today' : ''}"><h3>${DAYS[d]}${d === lagosDay() ? html` <span class="chip chip-blue">Today</span>` : ''}</h3>
          ${items.length ? items.map((c) => html`<div class="slot"><strong>${c.start} – ${c.end}</strong>
            <span>${c.code} · ${c.title}</span><small class="muted">${c.venue || ''}</small></div>`) : html`<p class="muted small">Free day</p>`}</section>`; })}</div>`
        : empty('No classes to show', 'Register your courses first and your timetable will appear.',
            html`<a class="btn btn-primary" href="/courses/register">Register courses</a>`)}`,
    });
  });

  // ---------------- News ----------------
  r.get('/announcements', only, (req, res) =>
    show(req, res, { title: 'News', active: '/announcements', body: html`${pageHead('News', 'Messages from the school')}<div class="card">${announcementList(announcementsFor(req.db, 'student'))}</div>` }));

  return r;
}

export { announcementsFor };
