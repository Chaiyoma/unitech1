# UniTech Port Harcourt — Student Portal

A clean, secure portal for students, lecturers and administrators of a university in Port Harcourt, Nigeria.
Primary colour **blue**, secondary colour **red** (used sparingly for money and alerts).

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env          # adjust if needed
npm run seed                  # optional: demo data (prints a temporary password)
npm start                     # http://localhost:3000
npm test                      # 17 automated tests
```

Demo sign-ins after seeding (everyone must choose a new password on first sign-in):

| Role     | ID                 |
|----------|--------------------|
| Student  | `UT/2025/CSC/0001` |
| Lecturer | `STF/0001`         |
| Admin    | `ADM/0001`         |

## What each person can do

- **Students** — register courses (24-unit cap), see results and CGPA (Nigerian 5-point scale), view and pay fees in ₦, timetable, news.
- **Lecturers** — see their courses and registered students, enter scores, post announcements to students.
- **Admins** — add students/staff (one-time temporary password), send fees to students, post announcements to anyone, see activity.

## Built to be easy

Every student task is one big, plainly named card on the Home page. The same six items sit in the left menu on a
computer and in a bottom bar on a phone. One main action per screen, plain words, helpful error messages.

## Security

- Passwords hashed with scrypt (salted); strong-password rules; forced change on first sign-in.
- Server-side sessions (random token, only its hash stored), `HttpOnly` + `SameSite=Lax` (+ `Secure`/`__Host-` in production), 45-min idle / 8-h absolute timeout.
- CSRF token on every form; sign-in has its own pre-session token.
- Login rate limit per IP and account lockout (5 wrong tries → 15 min); same message for unknown ID and wrong password.
- Role checks on every route, and ownership checks (students only see their own invoices, lecturers only their own courses).
- Strict Content-Security-Policy (no inline scripts/styles), HSTS in production, no framework banner, `no-store` caching.
- All output auto-escaped; all SQL parameterised; input validated and length-limited.
- Audit log of sign-ins, score changes, fees and account creation.

## Before going live

1. Set `NODE_ENV=production`, serve over HTTPS, and `TRUST_PROXY=1` if behind a proxy.
2. **Payments:** `PAYMENT_MODE=demo` only creates test receipts. Wire in a real gateway (Remita / Paystack / Flutterwave) and set another mode.
3. Replace the sample university name, departments and courses (`UNI_NAME`, `src/routes/admin.js`, `src/seed.js`).
4. Back up `data/unitech.db`. For many thousands of concurrent users, move to PostgreSQL.
5. Add email/SMS password reset (today a student visits the ICT Help Desk).
