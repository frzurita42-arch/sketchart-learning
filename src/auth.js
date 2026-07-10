/* Stateless signed auth tokens + the auth / adminOnly Express middleware. */
const crypto = require('crypto');
const { AUTH_TOKEN_SECRET } = require('./config');
const { db } = require('./db/pool');
const { userState, loadUsers } = require('./db/users');

function b64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(input) {
  const base64 = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signAuthToken(payload) {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', AUTH_TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${sig}`;
}

function verifyAuthToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = crypto
    .createHmac('sha256', AUTH_TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(body));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.u || typeof payload.u !== 'string') return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = verifyAuthToken(token);
    if (!payload) return res.status(401).json({ error: 'Not signed in' });
    const username = payload.u;
    req.user = userState.users.find(u => u.username === username) || null;
    if (!req.user && db.pool) {
      userState.users = await loadUsers();
      req.user = userState.users.find(u => u.username === username) || null;
    }
    if (!req.user) return res.status(401).json({ error: 'Unknown user' });
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth failed' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { b64urlEncode, b64urlDecode, signAuthToken, verifyAuthToken, auth, adminOnly };
