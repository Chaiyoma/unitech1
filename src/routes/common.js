import { layout } from '../ui.js';

/** Only let signed-in users with one of these roles through. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!roles.includes(req.user.role)) return res.redirect('/');
  next();
};

export const homeFor = (user) =>
  !user ? '/login' : user.role === 'student' ? '/home' : user.role === 'lecturer' ? '/staff' : '/admin';

/** Render a signed-in page inside the standard layout. */
export const show = (req, res, { title, active, body, wide, status = 200 }) =>
  res.send_html(layout({ title, user: req.user, session: req.session, active, body, wide, flash: res.locals.takeFlash() }), status);

export const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanMultiline = (v, max = 2000) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
export const intParam = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
export const ip = (req) => req.ip || '';
