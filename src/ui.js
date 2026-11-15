// Tiny HTML templating with automatic escaping, plus shared layout pieces.
class Safe { constructor(s) { this.s = s; } }
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => MAP[c]);
const render = (v) =>
  v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v);

export const raw = (s) => new Safe(s);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}
export const toString = (safe) => safe.s;

export const UNI_NAME = process.env.UNI_NAME || 'UniTech Port Harcourt';

// ---------- formatting helpers ----------
export const naira = (kobo) =>
  '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
export const fmtDateStr = (s) => (s ? fmtDate(Date.parse(s + 'T12:00:00Z')) : '');
export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export const firstName = (name) => String(name).trim().split(/\s+/)[0];

// ---------- icons (trusted static SVG) ----------
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20M16 15h2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
};
export const icon = (name, cls = '') =>
  raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

export const csrfField = (token) => html`<input type="hidden" name="_csrf" value="${token}">`;

export const NAV = {
  student: [
    ['/home', 'Home', 'home'],
    ['/courses', 'My Courses', 'book', 'Courses'],
    ['/results', 'My Results', 'chart', 'Results'],
    ['/fees', 'Pay Fees', 'wallet', 'Fees'],
    ['/timetable', 'Timetable', 'calendar'],
    ['/announcements', 'News', 'bell'],
  ],
  lecturer: [
    ['/staff', 'Home', 'home'],
    ['/staff/announce', 'Announcements', 'bell', 'News'],
  ],
  admin: [
    ['/admin', 'Overview', 'home'],
    ['/admin/users', 'People', 'users'],
    ['/admin/fees', 'Fees', 'wallet'],
    ['/staff/announce', 'Announcements', 'bell'],
  ],
};
const SECONDARY = [
  ['/profile', 'My Profile', 'user'],
  ['/help', 'Help', 'help'],
];

const brand = () => html`
  <a class="brand" href="/" aria-label="${UNI_NAME} home">
    <span class="brand-mark" aria-hidden="true"><span></span></span>
    <span class="brand-text"><strong>UniTech</strong><small>Port Harcourt</small></span>
  </a>`;

/** Full page for signed-in users. */
export function layout({ title, user, session, active, body, flash, wide = false }) {
  const items = NAV[user.role] || [];
  const link = ([href, label, ic]) =>
    html`<a href="${href}" class="nav-link${active === href ? ' is-active' : ''}"${active === href ? raw(' aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`;
  return page({
    title,
    body: html`
    <div class="shell">
      <aside class="sidebar" aria-label="Main menu">
        ${brand()}
        <nav class="nav">${items.map(link)}</nav>
        <nav class="nav nav-bottom">
          ${SECONDARY.map(link)}
          <form method="post" action="/logout">${csrfField(session.csrf)}
            <button class="nav-link nav-btn" type="submit">${icon('logout')}<span>Sign out</span></button>
          </form>
        </nav>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar-brand">${brand()}</div>
          <div class="who"><span class="avatar" aria-hidden="true">${firstName(user.name)[0]}</span>
            <span class="who-text"><strong>${user.name}</strong><small>${user.role === 'student' ? user.login_id : user.role === 'lecturer' ? 'Lecturer' : 'Administrator'}</small></span>
          </div>
        </header>
        <main id="content" class="content${wide ? ' content-wide' : ''}">
          ${flash ? html`<div class="flash flash-${flash.type}" role="status">${icon(flash.type === 'error' ? 'alert' : 'check')}<span>${flash.text}</span></div>` : ''}
          ${body}
        </main>
      </div>
      <nav class="tabbar" aria-label="Quick menu">
        ${items.slice(0, 5).map(([href, label, ic, short]) =>
          html`<a href="${href}" class="tab${active === href ? ' is-active' : ''}">${icon(ic)}<span>${short || label}</span></a>`)}
        <a href="/profile" class="tab${active === '/profile' ? ' is-active' : ''}">${icon('user')}<span>Me</span></a>
      </nav>
    </div>`,
  });
}

/** Bare page shell (login etc). */
export function page({ title, body, bodyClass = '' }) {
  return html`<!doctype html>
<html lang="en-NG">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="robots" content="noindex">
  <title>${title} · ${UNI_NAME}</title>
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/app.css">
  <script src="/js/app.js" defer></script>
</head>
<body class="${bodyClass}">
  <a class="skip" href="#content">Skip to content</a>
  ${body}
</body>
</html>`;
}

export const pageHead = (title, sub, action) => html`
  <div class="page-head">
    <div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>
    ${action || ''}
  </div>`;

export const empty = (title, text, action) => html`
  <div class="empty"><div class="empty-ic">${icon('book')}</div><h3>${title}</h3><p class="muted">${text}</p>${action || ''}</div>`;

export const errorPage = ({ code, title, text, user }) =>
  page({
    title,
    body: html`<main id="content" class="center-card"><div class="card narrow tc">
      <p class="err-code">${code}</p><h1>${title}</h1><p class="muted">${text}</p>
      <a class="btn btn-primary" href="/">${user ? 'Go to my home page' : 'Back to sign in'}</a></div></main>`,
  });
