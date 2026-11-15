import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCookies, randomToken, sha256, safeEqual } from './security.js';
import { toString, errorPage } from './ui.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/student.js';
import { staffRoutes } from './routes/staff.js';
import { adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDLE_MS = 45 * 60 * 1000;          // sign out after 45 min of inactivity
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;  // ...or 8 hours after signing in

export function createApp(db, opts = {}) {
  const isProd = (opts.env || process.env.NODE_ENV) === 'production';
  const cookieName = isProd ? '__Host-sid' : 'sid';
  const config = {
    isProd,
    cookieName,
    session: opts.session || process.env.CURRENT_SESSION || '2026/2027',
    semester: Number(opts.semester || process.env.CURRENT_SEMESTER || 1),
    paymentMode: opts.paymentMode || process.env.PAYMENT_MODE || 'demo',
    loginLimit: opts.loginLimit ?? 15,
  };

  const app = express();
  app.disable('x-powered-by');
  if ((opts.trustProxy ?? process.env.TRUST_PROXY) == 1) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  app.use('/css', express.static(path.join(__dirname, '../public/css'), { maxAge: '1h' }));
  app.use('/js', express.static(path.join(__dirname, '../public/js'), { maxAge: '1h' }));
  app.use('/img', express.static(path.join(__dirname, '../public/img'), { maxAge: '1d' }));
  app.get('/healthz', (_req, res) => res.type('text').send('ok'));

  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 300 }));

  // ----- session loading -----
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.cookies = parseCookies(req.headers.cookie);
    req.db = db;
    req.config = config;
    req.user = null;
    req.session = null;
    const token = req.cookies[cookieName];
    if (token) {
      const now = Date.now();
      const row = db.prepare(`SELECT s.id sid, s.csrf, s.flash, s.created_at, s.last_seen, u.*
                              FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha256(token));
      if (row && now - row.last_seen < IDLE_MS && now - row.created_at < ABSOLUTE_MS) {
        req.session = { id: row.sid, csrf: row.csrf, flash: row.flash ? JSON.parse(row.flash) : null };
        req.user = row;
        if (now - row.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, row.sid);
      } else if (row) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sid);
      }
    }
    // helpers
    req.flash = (type, text) => {
      if (req.session) db.prepare('UPDATE sessions SET flash = ? WHERE id = ?').run(JSON.stringify({ type, text }), req.session.id);
    };
    res.locals.takeFlash = () => {
      const f = req.session?.flash || null;
      if (f) { db.prepare('UPDATE sessions SET flash = NULL WHERE id = ?').run(req.session.id); req.session.flash = null; }
      return f;
    };
    res.send_html = (safe, status = 200) => res.status(status).type('html').send(toString(safe));
    next();
  });

  // ----- CSRF for every state-changing request from a signed-in user -----
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.user && !safeEqual(req.body?._csrf ?? '', req.session.csrf)) {
      return res.send_html(errorPage({ code: 403, title: 'That page expired', text: 'For your safety, please go back and try again.', user: req.user }), 403);
    }
    next();
  });

  // ----- first sign-in: must choose a new password -----
  app.use((req, res, next) => {
    if (req.user?.must_change_pw && !['/password', '/logout'].includes(req.path)) return res.redirect('/password');
    next();
  });

  app.use(authRoutes(config));
  app.use(studentRoutes(config));
  app.use(staffRoutes(config));
  app.use(adminRoutes(config));

  app.use((req, res) =>
    res.send_html(errorPage({ code: 404, title: "We can't find that page", text: 'The link may be old or mistyped.', user: req.user }), 404));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (!isProd || process.env.LOG_ERRORS) console.error(err);
    else console.error(`[error] ${req.method} ${req.path}: ${err.message}`);
    res.send_html(errorPage({ code: 500, title: 'Something went wrong', text: 'It is not your fault. Please try again in a moment.', user: req.user }), 500);
  });

  return app;
}

export { randomToken, sha256 };
