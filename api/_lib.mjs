// Shared helpers for the Vercel functions. Files starting with _ are not routes.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

// The site is public, so every function that spends credits or writes to Notion
// checks the passcode set in Vercel (TOOLS_PASSCODE).
export function checkPasscode(req, res) {
  const expected = process.env.TOOLS_PASSCODE;
  if (!expected) {
    res.status(500).json({ error: 'not-configured', message: 'TOOLS_PASSCODE is not set in Vercel.' });
    return false;
  }
  const given = req.headers['x-tools-passcode'] || '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    res.status(401).json({ error: 'passcode', message: 'Wrong passcode.' });
    return false;
  }
  return true;
}

export function requireEnv(res, ...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    res.status(500).json({ error: 'not-configured', message: `Missing in Vercel: ${missing.join(', ')}` });
    return false;
  }
  return true;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
