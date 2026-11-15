// Vercel entry point. Preview mode: temporary SQLite in /tmp, auto-seeded with demo data.
// Data resets when the serverless instance restarts — use a hosted database for real use.
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { tempPassword } from '../src/security.js';

const db = openDb(process.env.DB_FILE || '/tmp/unitech.db');
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const pw = process.env.DEMO_PASSWORD || tempPassword();
  await seedDemo(db, pw);
  if (!process.env.DEMO_PASSWORD) console.log(`[preview] demo accounts seeded; temporary password: ${pw}`);
}

export default createApp(db, { env: 'production', trustProxy: 1 });
