import { Router } from 'express';
import { hashPassword, tempPassword } from '../security.js';
import { audit } from '../db.js';
import { html, icon, csrfField, naira, fmtDate, fmtDateStr, pageHead, empty } from '../ui.js';
import { requireRole, show, clean, ip } from './common.js';

const DEPT_CODES = { 'Computer Science': 'CSC', 'Petroleum Engineering': 'PET', Accounting: 'ACC' };
const DEPARTMENTS = Object.keys(DEPT_CODES);
const ROLE_PREFIX = { lecturer: 'STF', admin: 'ADM' };

export function adminRoutes(config) {
  const r = Router();
  const admin = requireRole('admin');

  r.get('/admin', admin, (req, res) => {
    const c = (sql, ...p) => req.db.prepare(sql).get(...p).n;
    const owing = req.db.prepare('SELECT COALESCE(SUM(amount_kobo),0) t FROM invoices WHERE paid_at IS NULL').get().t;
    const stats = [
      ['Students', c("SELECT COUNT(*) n FROM users WHERE role='student'"), 'users'],
      ['Lecturers', c("SELECT COUNT(*) n FROM users WHERE role='lecturer'"), 'user'],
      ['Courses this semester', c('SELECT COUNT(*) n FROM courses WHERE session = ? AND semester = ?', config.session, config.semester), 'book'],
      ['Fees not yet paid', naira(owing), 'wallet'],
    ];
    const recent = req.db.prepare(`SELECT a.action, a.created_at, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action NOT IN ('login','logout') ORDER BY a.id DESC LIMIT 6`).all();
    show(req, res, {
      title: 'Overview', active: '/admin', body: html`
      ${pageHead('Overview', `${config.session} session · ${config.semester === 1 ? 'First' : 'Second'} semester`)}
      <div class="tiles tiles-4">${stats.map(([t, v, ic]) => html`<div class="tile static"><span class="tile-ic">${icon(ic)}</span><strong class="num">${v}</strong><span class="muted">${t}</span></div>`)}</div>
      <div class="two">
        <section class="card"><h2>What would you like to do?</h2><div class="actions">
          <a class="btn btn-primary" href="/admin/users">${icon('plus')} Add a student or staff</a>
          <a class="btn btn-ghost" href="/admin/fees">${icon('wallet')} Send a fee to a student</a>
          <a class="btn btn-ghost" href="/staff/announce">${icon('bell')} Post an announcement</a></div></section>
        <section class="card"><h2>Recent activity</h2>
          ${recent.length ? html`<ul class="rows">${recent.map((a) => html`<li><span class="dot"></span><div><strong>${a.name || 'System'}</strong>
            <small class="muted">${a.action.replace(/_/g, ' ')} · ${fmtDate(a.created_at)}</small></div></li>`)}</ul>` : html`<p class="muted pad">Nothing yet.</p>`}</section>
      </div>`,
    });
  });

  // ---------------- People ----------------
  const usersPage = (req, res, { error, created, values = {}, status = 200 } = {}) => {
    const q = clean(req.query.q, 60);
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const people = req.db.prepare(`SELECT * FROM users WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR login_id LIKE ? ESCAPE '\\')
      ORDER BY role, name LIMIT 100`).all(q, like, like);
    show(req, res, {
      status, title: 'People', active: '/admin/users', wide: true, body: html`
      ${pageHead('People', 'Add new students and staff, or search for someone.')}
      ${created ? html`<div class="card cred" role="status"><h2>${icon('check')} Account created</h2>
        <p>Give these details to <strong>${created.name}</strong>. <strong>This password is shown only once.</strong> They will choose their own password at first sign-in.</p>
        <dl class="summary"><dt>Sign-in ID</dt><dd><code>${created.login_id}</code></dd><dt>Temporary password</dt><dd><code>${created.password}</code></dd></dl></div>` : ''}
      <div class="two">
        <form class="card form" method="post" action="/admin/users" novalidate>
          <h2>Add someone new</h2>${csrfField(req.session.csrf)}
          ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
          <div class="field"><label for="role">This person is a</label>
            <select id="role" name="role"><option value="student">Student</option><option value="lecturer">Lecturer</option><option value="admin">Administrator</option></select></div>
          <div class="field"><label for="name">Full name</label><input id="name" name="name" maxlength="80" value="${values.name || ''}" required></div>
          <div class="field"><label for="email">Email (optional)</label><input id="email" name="email" type="email" maxlength="120" value="${values.email || ''}"></div>
          <div class="field"><label for="department">Department</label><select id="department" name="department">${DEPARTMENTS.map((d) => html`<option>${d}</option>`)}</select></div>
          <div class="field" data-only="student"><label for="level">Level (students only)</label>
            <select id="level" name="level">${[100, 200, 300, 400, 500].map((l) => html`<option value="${l}"${l === 100 ? ' selected' : ''}>${l} Level</option>`)}</select></div>
          <button class="btn btn-primary" type="submit">${icon('plus')} Create account</button>
        </form>
        <section class="card flush"><div class="card-head"><h2>Everyone</h2>
          <form method="get" action="/admin/users" class="search"><input name="q" type="search" placeholder="Search name or ID" value="${q}" aria-label="Search people"></form></div>
          <table class="table"><thead><tr><th>Name</th><th>ID</th><th>Role</th></tr></thead>
          <tbody>${people.map((p) => html`<tr><td><strong>${p.name}</strong></td><td class="muted">${p.login_id}</td><td><span class="chip">${p.role}</span></td></tr>`)}</tbody></table></section>
      </div>`,
    });
  };

  r.get('/admin/users', admin, (req, res) => usersPage(req, res));

  r.post('/admin/users', admin, async (req, res, next) => {
    try {
      const role = ['student', 'lecturer', 'admin'].includes(req.body.role) ? req.body.role : 'student';
      const name = clean(req.body.name, 80);
      const email = clean(req.body.email, 120);
      const department = DEPARTMENTS.includes(req.body.department) ? req.body.department : DEPARTMENTS[0];
      const level = role === 'student' ? ([100, 200, 300, 400, 500].includes(Number(req.body.level)) ? Number(req.body.level) : 100) : null;
      const values = { name, email };
      if (name.length < 3) return usersPage(req, res, { error: 'Please type the full name.', values, status: 400 });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return usersPage(req, res, { error: 'That email does not look right.', values, status: 400 });

      const year = new Date().getFullYear();
      const code = DEPT_CODES[department];
      const prefix = role === 'student' ? `UT/${year}/${code}/` : `${ROLE_PREFIX[role]}/`;
      const last = req.db.prepare('SELECT login_id FROM users WHERE login_id LIKE ? ORDER BY login_id DESC LIMIT 1').get(prefix + '%');
      const next = (last ? Number(last.login_id.split('/').pop()) + 1 : 1);
      const loginId = prefix + String(next).padStart(4, '0');
      const password = tempPassword();
      req.db.prepare(`INSERT INTO users (role, login_id, name, email, pw_hash, must_change_pw, department, level, created_at)
        VALUES (?,?,?,?,?,1,?,?,?)`).run(role, loginId, name, email || null, await hashPassword(password), role === 'admin' ? null : department, level, Date.now());
      audit(req.db, req.user.id, 'user_created', `${role} ${loginId}`, ip(req));
      usersPage(req, res, { created: { name, login_id: loginId, password } });
    } catch (e) { next(e); }
  });

  // ---------------- Fees ----------------
  const feesPage = (req, res, { error, values = {}, status = 200 } = {}) => {
    const recent = req.db.prepare(`SELECT i.*, u.name, u.login_id FROM invoices i JOIN users u ON u.id = i.student_id ORDER BY i.id DESC LIMIT 15`).all();
    show(req, res, {
      status, title: 'Fees', active: '/admin/fees', wide: true, body: html`
      ${pageHead('Fees', 'Send a fee to a student. They will see it under "Pay Fees".')}
      <div class="two">
        <form class="card form" method="post" action="/admin/fees" novalidate>
          <h2>New fee</h2>${csrfField(req.session.csrf)}
          ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
          <div class="field"><label for="matric">Student's matric number</label><input id="matric" name="matric" placeholder="UT/2026/CSC/0001" value="${values.matric || ''}" required></div>
          <div class="field"><label for="title">What is the fee for?</label><input id="title" name="title" maxlength="100" placeholder="e.g. School fees 2026/2027" value="${values.title || ''}" required></div>
          <div class="field"><label for="amount">Amount (₦)</label><input id="amount" name="amount" inputmode="decimal" placeholder="150000" value="${values.amount || ''}" required></div>
          <div class="field"><label for="due">Pay before (optional)</label><input id="due" name="due" type="date" value="${values.due || ''}"></div>
          <button class="btn btn-primary" type="submit">${icon('plus')} Send fee</button>
        </form>
        <section class="card flush"><div class="card-head"><h2>Recently sent</h2></div>
          ${recent.length ? html`<table class="table"><thead><tr><th>Student</th><th>Fee</th><th>Amount</th><th>Status</th></tr></thead><tbody>
            ${recent.map((i) => html`<tr><td><strong>${i.name}</strong><br><small class="muted">${i.login_id}</small></td><td>${i.title}<br><small class="muted">${i.due ? 'Due ' + fmtDateStr(i.due) : ''}</small></td><td>${naira(i.amount_kobo)}</td>
              <td>${i.paid_at ? html`<span class="chip chip-ok">Paid</span>` : html`<span class="chip chip-red">Unpaid</span>`}</td></tr>`)}</tbody></table>`
            : empty('Nothing sent yet', 'Fees you send will be listed here.')}</section>
      </div>`,
    });
  };
  r.get('/admin/fees', admin, (req, res) => feesPage(req, res));
  r.post('/admin/fees', admin, (req, res) => {
    const matric = clean(req.body.matric, 40).toUpperCase();
    const title = clean(req.body.title, 100);
    const amountRaw = clean(req.body.amount, 15).replace(/,/g, '');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body.due || '') ? req.body.due : null;
    const values = { matric, title, amount: amountRaw, due: due || '' };
    const bad = (error) => feesPage(req, res, { error, values, status: 400 });
    const student = req.db.prepare("SELECT id, name FROM users WHERE login_id = ? AND role = 'student'").get(matric);
    if (!student) return bad('We could not find a student with that matric number.');
    if (!title) return bad('Please say what the fee is for.');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) return bad('Type the amount using numbers only, for example 150000.');
    const kobo = Math.round(Number(amountRaw) * 100);
    req.db.prepare('INSERT INTO invoices (student_id, title, amount_kobo, due) VALUES (?,?,?,?)').run(student.id, title, kobo, due);
    audit(req.db, req.user.id, 'invoice_created', `${matric} ${kobo}`, ip(req));
    req.flash('ok', `Fee of ${naira(kobo)} sent to ${student.name}.`);
    res.redirect('/admin/fees');
  });

  return r;
}
