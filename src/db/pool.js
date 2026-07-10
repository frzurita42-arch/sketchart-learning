/* Postgres connection pool + query helpers.
 *
 * IMPORTANT: the pool is reassigned at runtime — if the configured DB is
 * unreachable at boot we downgrade to file storage by setting the pool to null.
 * require() hands out a live reference to this module's exports object, so we
 * expose a MUTABLE HOLDER (`db.pool`) rather than the Pool itself. Every consumer
 * reads `db.pool`, and the boot downgrade does `db.pool = null`, which all
 * consumers then see. Never destructure the pool out by value. */
const { Pool } = require('pg');
const { DATABASE_URL, dbEnabled } = require('../config');

const db = {
  pool: dbEnabled
    ? new Pool({
        connectionString: DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
        // Cap how long we wait to establish a connection so a truly unreachable DB fails
        // fast at boot (then we downgrade to file storage) instead of hanging. Individual
        // slow queries (e.g. a cold-starting free-tier DB) are bounded per-call by
        // withDbTimeout so the boot DDL is never killed mid-flight.
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
      })
    : null
};

if (db.pool) {
  // A pool 'error' on an idle client would otherwise crash the process.
  db.pool.on('error', (err) => console.error('Postgres pool error:', err.message));
}

async function dbQuery(text, params = []) {
  if (!db.pool) throw new Error('Database is not configured');
  return db.pool.query(text, params);
}

// Bound a DB operation so a slow/hung query rejects quickly and callers can fall back.
function withDbTimeout(promise, ms = 8000, label = 'DB operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { db, dbQuery, withDbTimeout };
