import fs from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';

// Minimal .env loader (no extra dependency).
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const db = openDb();
const app = createApp(db);
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`UniTech portal running on http://localhost:${port}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
