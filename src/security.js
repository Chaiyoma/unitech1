import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const SCRYPT_OPTS = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, SCRYPT_OPTS);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash || Number(n) !== N) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT_OPTS);
  return crypto.timingSafeEqual(key, expected);
}

/** Used to burn the same time when a login id does not exist (prevents user enumeration). */
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));

/** Returns an error message, or null if the password is acceptable. */
export function passwordProblem(pw, loginId = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Password is too long (max 128 characters).';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw))
    return 'Mix capital letters, small letters and at least one number.';
  if (loginId && pw.toLowerCase().includes(loginId.toLowerCase())) return 'Do not include your ID in your password.';
  return null;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Easy-to-read temporary password (no look-alike characters). Always satisfies passwordProblem(). */
export function tempPassword() {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789';
  const all = U + L + D;
  const chars = [pick(U), pick(L), pick(D)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}
