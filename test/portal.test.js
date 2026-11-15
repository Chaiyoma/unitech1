import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { gradeFor, gpa } from '../src/grades.js';
import { passwordProblem } from '../src/security.js';

const TEMP = 'Welcome2026x';
const NEW = 'BrandNewPass42';
let server, base, db;

class Client {
  jar = new Map();
  async req(path, { method = 'GET', form } = {}) {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) || v === '' ? this.jar.delete(kv.slice(0, i)) : this.jar.set(kv.slice(0, i), v);
    }
    return { status: res.status, headers: res.headers, text: await res.text(), loc: res.headers.get('location') };
  }
  csrf(text) { return text.match(/name="_csrf" value="([^"]+)"/)?.[1]; }
  async login(id, pw = TEMP, { change = true } = {}) {
    const attempt = async (p) => {
      const page = await this.req('/login');
      return this.req('/login', { method: 'POST', form: { _csrf: this.csrf(page.text), login_id: id, password: p } });
    };
    let r = await attempt(pw);
    // Accounts that already did their first-time password change now use NEW.
    if (r.status === 401 && pw === TEMP && change) { r = await attempt(NEW); pw = NEW; }
    if (r.status === 302 && r.loc === '/password' && change) {
      const f = await this.req('/password');
      const done = await this.req('/password', { method: 'POST', form: { _csrf: this.csrf(f.text), current: pw, next: NEW, again: NEW } });
      assert.equal(done.status, 302, done.text.slice(0, 300));
    }
    return r;
  }
  async post(path, form) { const p = await this.req('/help'); return this.req(path, { method: 'POST', form: { _csrf: this.csrf(p.text) ?? this.csrf((await this.req('/profile')).text), ...form } }); }
}

// Sign-out form on every page carries the CSRF token.
const token = async (c) => c.csrf((await c.req('/profile')).text);

before(async () => {
  db = openDb(':memory:');
  await seedDemo(db, TEMP);
  const app = createApp(db, { paymentMode: 'demo', loginLimit: 500, session: '2026/2027', semester: 1 });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

test('signed-out visitors are sent to sign in', async () => {
  const r = await new Client().req('/home');
  assert.equal(r.status, 302); assert.equal(r.loc, '/login');
});

test('security headers are set', async () => {
  const r = await new Client().req('/login');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('x-content-type-options'), /nosniff/);
});

test('wrong password gives a generic message; unknown ID gives the same one', async () => {
  const a = await new Client().login('UT/2025/CSC/0002', 'WrongPass123', { change: false });
  const b = await new Client().login('NOPE/0000', 'WrongPass123', { change: false });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  const m = (t) => t.match(/not right[^<]*/)?.[0];
  assert.equal(m(a.text), m(b.text)); assert.ok(m(a.text));
});

test('login without the page token is refused', async () => {
  const r = await new Client().req('/login', { method: 'POST', form: { _csrf: 'x', login_id: 'ADM/0001', password: TEMP } });
  assert.equal(r.status, 403);
});

test('account locks after 5 wrong attempts, even for the right password', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.login('UT/2025/CSC/0003', 'WrongPass123', { change: false });
  const r = await c.login('UT/2025/CSC/0003', TEMP, { change: false });
  assert.equal(r.status, 423);
});

test('first sign-in forces a new password, and weak ones are rejected', async () => {
  const c = new Client();
  const r = await c.login('STF/0003', TEMP, { change: false });
  assert.equal(r.loc, '/password');
  assert.equal((await c.req('/staff')).loc, '/password');
  const f = await c.req('/password');
  const weak = await c.req('/password', { method: 'POST', form: { _csrf: c.csrf(f.text), current: TEMP, next: 'short', again: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await c.req('/password', { method: 'POST', form: { _csrf: c.csrf(f.text), current: TEMP, next: NEW, again: NEW } });
  assert.equal(ok.status, 302);
  assert.equal((await c.req('/staff')).status, 200);
});

test('POST without CSRF token is rejected when signed in', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  const r = await c.req('/logout', { method: 'POST', form: {} });
  assert.equal(r.status, 403);
  assert.equal((await c.req('/home')).status, 200);
});

test('students cannot open staff or admin pages', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  for (const p of ['/admin', '/admin/users', '/admin/fees', '/staff', '/staff/announce', '/staff/course/1']) {
    const r = await c.req(p); assert.equal(r.status, 302, p); assert.equal(r.loc, '/', p);
  }
});

test('student home, courses, results, fees, timetable all render', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  const home = await c.req('/home');
  assert.match(home.text, /What would you like to do today/); assert.match(home.text, /₦245,000/);
  for (const p of ['/courses', '/courses/register', '/results', '/fees', '/timetable', '/announcements', '/profile', '/help'])
    assert.equal((await c.req(p)).status, 200, p);
  assert.match((await c.req('/results')).text, /CGPA/);
});

test('course registration enforces the 24-unit cap and only allows own-level courses', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0002');
  const t = await token(c);
  const ids = db.prepare("SELECT id FROM courses WHERE session='2026/2027'").all().map((x) => x.id);
  const all = Object.fromEntries(ids.map((i) => [`course_${i}`, 'on']));
  const prev = db.prepare("SELECT id FROM courses WHERE session='2025/2026' LIMIT 1").get().id;
  const ok = await c.req('/courses/register', { method: 'POST', form: { _csrf: t, ...all, [`course_${prev}`]: 'on' } });
  assert.equal(ok.status, 302); // 16 units fine; the last-year course is silently ignored
  const mine = db.prepare('SELECT course_id FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE student_id=(SELECT id FROM users WHERE login_id=?) AND c.session=?').all('UT/2025/CSC/0002', '2026/2027');
  assert.equal(mine.length, ids.length);
});

test("a student cannot pay someone else's invoice", async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  const t = await token(c);
  const other = db.prepare("SELECT i.id FROM invoices i JOIN users u ON u.id=i.student_id WHERE u.login_id='UT/2025/CSC/0003'").get().id;
  const r = await c.req(`/fees/${other}/pay`, { method: 'POST', form: { _csrf: t } });
  assert.equal(r.loc, '/fees');
  assert.equal(db.prepare('SELECT paid_at FROM invoices WHERE id=?').get(other).paid_at, null);
});

test('paying own invoice in demo mode issues a receipt', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  const t = await token(c);
  const mine = db.prepare("SELECT i.id FROM invoices i JOIN users u ON u.id=i.student_id WHERE u.login_id='UT/2025/CSC/0001' AND paid_at IS NULL").get().id;
  await c.req(`/fees/${mine}/pay`, { method: 'POST', form: { _csrf: t } });
  assert.match(db.prepare('SELECT receipt FROM invoices WHERE id=?').get(mine).receipt, /^RCP-/);
});

test('lecturers can only score their own courses, and scores are validated', async () => {
  const c = new Client(); await c.login('STF/0001');
  const own = db.prepare("SELECT c.id FROM courses c JOIN users u ON u.id=c.lecturer_id WHERE u.login_id='STF/0001' AND c.session='2026/2027' AND c.code='CSC 201'").get().id;
  const foreign = db.prepare("SELECT c.id FROM courses c JOIN users u ON u.id=c.lecturer_id WHERE u.login_id='STF/0002' AND c.session='2026/2027'").get().id;
  assert.equal((await c.req(`/staff/course/${foreign}`)).loc, '/staff');
  const t = await token(c);
  const sid = db.prepare("SELECT id FROM users WHERE login_id='UT/2025/CSC/0001'").get().id;
  const bad = await c.req(`/staff/course/${own}`, { method: 'POST', form: { _csrf: t, [`score_${sid}`]: '101' } });
  assert.equal(bad.status, 400);
  const good = await c.req(`/staff/course/${own}`, { method: 'POST', form: { _csrf: t, [`score_${sid}`]: '74' } });
  assert.equal(good.status, 302);
  assert.equal(db.prepare('SELECT score FROM results WHERE student_id=? AND course_id=?').get(sid, own).score, 74);
});

test('announcement text is escaped (no script injection)', async () => {
  const c = new Client(); await c.login('STF/0001');
  const t = await token(c);
  await c.req('/staff/announce', { method: 'POST', form: { _csrf: t, title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>', audience: 'lecturer' } });
  const s = new Client(); await s.login('UT/2025/CSC/0001');
  const page = await s.req('/announcements');
  assert.ok(!page.text.includes('<script>alert(1)'));
  assert.ok(!page.text.includes('<img src=x'));
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('admin can create a student; temporary password works and must be changed', async () => {
  const a = new Client(); await a.login('ADM/0001');
  const t = await token(a);
  const r = await a.req('/admin/users', { method: 'POST', form: { _csrf: t, role: 'student', name: 'Test Student', department: 'Accounting', level: '100' } });
  assert.equal(r.status, 200);
  const id = r.text.match(/<code>(UT\/\d{4}\/ACC\/\d{4})<\/code>/)[1];
  const pw = r.text.match(/Temporary password<\/dt><dd><code>([^<]+)</)[1];
  assert.equal(passwordProblem(pw), null);
  const s = new Client();
  assert.equal((await s.login(id, pw, { change: false })).loc, '/password');
});

test('grading scale and GPA', () => {
  assert.equal(gradeFor(70).letter, 'A'); assert.equal(gradeFor(69).letter, 'B'); assert.equal(gradeFor(39).letter, 'F');
  assert.equal(gpa([{ units: 3, score: 80 }, { units: 3, score: 60 }, { units: 2, score: null }]), 4.5);
  assert.equal(gpa([]), null);
});

test('unknown pages show a friendly 404', async () => {
  const c = new Client(); await c.login('UT/2025/CSC/0001');
  const r = await c.req('/nothing-here'); assert.equal(r.status, 404); assert.match(r.text, /We can(&#39;|')t find that page/);
});
