/* User accounts: password hashing, and load/persist across file or Postgres storage.
 *
 * The in-memory `users` array is reassigned in several places (login refresh,
 * create, delete), so it lives on a mutable holder (`userState.users`) that all
 * consumers read and write. */
const crypto = require('crypto');
const { db } = require('./pool');
const { readJSON, writeJSON } = require('./persistence');

const userState = { users: [] };

// ---------- users ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, salt, passwordHash: hashPassword(password, salt), role, createdAt: new Date().toISOString() };
}

async function loadUsers() {
  if (!db.pool) {
    return Array.isArray(userState.users) ? userState.users : [];
  }
  const { rows } = await db.pool.query('SELECT username, salt, password_hash, role, created_at FROM users ORDER BY created_at ASC');
  return rows.map(r => ({
    username: r.username,
    salt: r.salt,
    passwordHash: r.password_hash,
    role: r.role,
    createdAt: new Date(r.created_at).toISOString()
  }));
}

async function persistUsers(nextUsers) {
  userState.users = nextUsers;
  if (!db.pool) {
    writeJSON('users.json', nextUsers);
    return;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of nextUsers) {
      await client.query(
        `INSERT INTO users (username, salt, password_hash, role, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (username) DO UPDATE SET
           salt = EXCLUDED.salt,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           created_at = EXCLUDED.created_at`,
        [u.username, u.salt, u.passwordHash, u.role, u.createdAt || new Date().toISOString()]
      );
    }
    const usernames = nextUsers.map(u => u.username);
    if (usernames.length) {
      await client.query('DELETE FROM users WHERE username <> ALL($1::text[])', [usernames]);
    } else {
      await client.query('DELETE FROM users');
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { userState, hashPassword, makeUser, loadUsers, persistUsers };
