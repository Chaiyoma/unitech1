import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, randomToken, sha256, safeEqual } from '../security.js';
import { audit } from '../db.js';
import { html, page, icon, csrfField, UNI_NAME, pageHead } from '../ui.js';
import { homeFor, show, clean, ip } from './common.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PRE_CSRF = 'login_csrf';

function loginPage({ csrf, error, id = '', notice }) {
  return page({
    title: 'Sign in',
    bodyClass: 'auth-body',
    body: html`
    <div class="auth">
      <section class="auth-hero" aria-hidden="true">
        <div class="hero-inner">
          <span class="brand-mark big"><span></span></span>
          <h2>Welcome to<br>${UNI_NAME}</h2>
          <p>Courses, results, fees and news — all in one simple place.</p>
          <ul class="hero-points">
            <li>${icon('check')} See your courses and timetable</li>
            <li>${icon('check')} Check your results anytime</li>
            <li>${icon('check')} Pay school fees safely</li>
          </ul>
        </div>
      </section>
      <main id="content" class="auth-panel">
        <form class="auth-card" method="post" action="/login" autocomplete="on" novalidate>
          <h1>Sign in</h1>
          <p class="muted">Use your matric number (students) or staff ID.</p>
          ${notice ? html`<div class="flash flash-ok" role="status">${icon('check')}<span>${notice}</span></div>` : ''}
          ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
          <input type="hidden" name="_csrf" value="${csrf}">
          <div class="field">
            <label for="login_id">Matric number or Staff ID</label>
            <input id="login_id" name="login_id" type="text" inputmode="text" autocomplete="username" autocapitalize="characters"
                   placeholder="e.g. UT/2024/CSC/0142" value="${id}" required autofocus>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="pw">
              <input id="password" name="password" type="password" autocomplete="current-password" required>
              <button type="button" class="pw-toggle" data-toggle="#password" aria-label="Show password">${icon('eye')}</button>
            </div>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Sign in</button>
          <p class="hint">Forgot your password? Please visit the ICT Help Desk (Admin Block, Ground Floor) with your student ID card.</p>
          <p class="secure">${icon('shield')} Secure, private sign-in</p>
        </form>
      </main>
    </div>`,
  });
}

export function authRoutes(config) {
  const r = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const csrf = req.cookies[PRE_CSRF] || randomToken(16);
      res.send_html(loginPage({ csrf, error: 'Too many sign-in attempts. Please wait a few minutes and try again.' }), 429);
    },
  });

  r.get('/', (req, res) => res.redirect(homeFor(req.user)));

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(homeFor(req.user));
    const csrf = randomToken(16);
    res.cookie(PRE_CSRF, csrf, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/login', maxAge: 30 * 60 * 1000 });
    res.send_html(loginPage({ csrf, notice: req.query.out ? 'You have been signed out.' : '' }));
  });

  r.post('/login', limiter, async (req, res, next) => {
    try {
      const sent = String(req.body._csrf || '');
      const csrf = req.cookies[PRE_CSRF] || '';
      const loginId = clean(req.body.login_id, 60).toUpperCase();
      const password = String(req.body.password || '').slice(0, 200);
      const fail = (msg, status = 401) => {
        const fresh = randomToken(16);
        res.cookie(PRE_CSRF, fresh, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/login', maxAge: 30 * 60 * 1000 });
        return res.send_html(loginPage({ csrf: fresh, error: msg, id: loginId }), status);
      };
      if (!csrf || !safeEqual(sent, csrf)) return fail('Your page expired. Please try again.', 403);
      if (!loginId || !password) return fail('Please enter your ID and password.', 400);

      const u = req.db.prepare('SELECT * FROM users WHERE login_id = ?').get(loginId);
      const now = Date.now();
      if (u && u.locked_until > now) {
        await verifyPassword(password, DUMMY_HASH);
        audit(req.db, u.id, 'login_locked', '', ip(req));
        return fail('This account is locked for a short while after too many wrong attempts. Please try again in 15 minutes.', 423);
      }
      const ok = await verifyPassword(password, u ? u.pw_hash : DUMMY_HASH);
      if (!u || !ok) {
        if (u) {
          const fails = u.failed_attempts + 1;
          const lock = fails >= MAX_FAILS ? now + LOCK_MS : 0;
          req.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id);
          audit(req.db, u.id, 'login_failed', '', ip(req));
        }
        return fail('That ID or password is not right. Please check and try again.');
      }

      req.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(u.id);
      const token = randomToken(32);
      req.db.prepare('INSERT INTO sessions (id, user_id, csrf, created_at, last_seen) VALUES (?,?,?,?,?)')
        .run(sha256(token), u.id, randomToken(24), now, now);
      res.clearCookie(PRE_CSRF, { path: '/login' });
      res.cookie(config.cookieName, token, {
        httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 8 * 60 * 60 * 1000,
      });
      audit(req.db, u.id, 'login', '', ip(req));
      res.redirect(u.must_change_pw ? '/password' : homeFor(u));
    } catch (e) { next(e); }
  });

  r.post('/logout', (req, res) => {
    if (req.session) {
      req.db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
      audit(req.db, req.user.id, 'logout', '', ip(req));
    }
    res.clearCookie(config.cookieName, { path: '/' });
    res.redirect('/login?out=1');
  });

  // ----- change password (also the forced first-sign-in step) -----
  const passwordForm = (req, { error, first } = {}) => html`
    ${pageHead(first ? 'Create your own password' : 'Change password',
      first ? 'For your safety, choose a new password before you continue.' : 'Pick a strong password that only you know.')}
    <form class="card narrow form" method="post" action="/password" novalidate>
      ${csrfField(req.session.csrf)}
      ${error ? html`<div class="flash flash-error" role="alert">${icon('alert')}<span>${error}</span></div>` : ''}
      <div class="field"><label for="current">Current password</label>
        <input id="current" name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="next">New password</label>
        <input id="next" name="next" type="password" autocomplete="new-password" required>
        <small class="help">At least 10 characters, with capital letters, small letters and a number.</small></div>
      <div class="field"><label for="again">Type the new password again</label>
        <input id="again" name="again" type="password" autocomplete="new-password" required></div>
      <button class="btn btn-primary" type="submit">Save new password</button>
    </form>`;

  r.get('/password', (req, res) => {
    if (!req.user) return res.redirect('/login');
    show(req, res, { title: 'Change password', active: '/profile', body: passwordForm(req, { first: !!req.user.must_change_pw }) });
  });

  r.post('/password', async (req, res, next) => {
    try {
      if (!req.user) return res.redirect('/login');
      const first = !!req.user.must_change_pw;
      const again = (error) => show(req, res, { title: 'Change password', active: '/profile', body: passwordForm(req, { error, first }), status: 400 });
      const { current = '', next: next_ = '', again: repeat = '' } = req.body;
      if (!(await verifyPassword(String(current), req.user.pw_hash))) return again('Your current password is not correct.');
      if (next_ !== repeat) return again('The two new passwords are not the same.');
      if (next_ === current) return again('Choose a password that is different from the old one.');
      const problem = passwordProblem(next_, req.user.login_id);
      if (problem) return again(problem);
      req.db.prepare('UPDATE users SET pw_hash = ?, must_change_pw = 0 WHERE id = ?').run(await hashPassword(next_), req.user.id);
      // sign out every other device
      req.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
      audit(req.db, req.user.id, 'password_changed', '', ip(req));
      req.flash('ok', 'Your password has been changed.');
      res.redirect(homeFor(req.user));
    } catch (e) { next(e); }
  });

  return r;
}
