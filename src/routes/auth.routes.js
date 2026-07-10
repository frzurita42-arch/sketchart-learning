/* Auth + user-management routes. */
const express = require('express');
const crypto = require('crypto');
const { AUTH_TOKEN_TTL_SEC } = require('../config');
const { db } = require('../db/pool');
const { userState, makeUser, hashPassword, loadUsers, persistUsers } = require('../db/users');
const { readGames } = require('../db/games');
const { signAuthToken, auth, adminOnly } = require('../auth');

const router = express.Router();

// ---------- auth endpoints ----------
router.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (db.pool) userState.users = await loadUsers();
  const user = userState.users.find(u => u.username === username);
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const now = Math.floor(Date.now() / 1000);
  const token = signAuthToken({ u: user.username, iat: now, exp: now + AUTH_TOKEN_TTL_SEC, v: 1 });
  res.json({ token, username: user.username, role: user.role });
});

router.post('/api/logout', auth, (req, res) => {
  // Stateless tokens cannot be revoked server-side without a deny-list store.
  res.json({ ok: true });
});

router.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ---------- user management ----------
router.get('/api/users', auth, adminOnly, async (req, res) => {
  const games = await readGames();
  res.json(userState.users.map(u => ({
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    gamesPlayed: games.filter(g => g.username === u.username).length
  })));
});

router.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (userState.users.some(u => u.username === username)) return res.status(409).json({ error: 'User already exists' });
  userState.users.push(makeUser(username.trim(), password, role === 'admin' ? 'admin' : 'user'));
  await persistUsers(userState.users);
  res.json({ ok: true });
});

router.post('/api/users/:username/password', auth, async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (req.user.username !== username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only change your own password' });
  }
  const user = userState.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: 'No such user' });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.salt);
  await persistUsers(userState.users);
  res.json({ ok: true });
});

router.delete('/api/users/:username', auth, adminOnly, async (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  const before = userState.users.length;
  userState.users = userState.users.filter(u => u.username !== username);
  if (userState.users.length === before) return res.status(404).json({ error: 'No such user' });
  await persistUsers(userState.users);
  res.json({ ok: true });
});

module.exports = router;
