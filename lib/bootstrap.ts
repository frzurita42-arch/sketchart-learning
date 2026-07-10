import '@/lib/legacy-env';
import crypto from 'crypto';
import {
  SUGGESTED_STORE_FILE, HOME_TOPICS_STORE_FILE,
  DEFAULT_SUGGESTION_PAIR, DEFAULT_HOME_TOPIC_POOL,
} from '@/src/config';
import { db, dbQuery } from '@/src/db/pool';
import { readJSON, writeJSON, ensureDataDirs, initDatabase } from '@/src/db/persistence';
import { userState, makeUser, loadUsers, persistUsers } from '@/src/db/users';
import { insertGame } from '@/src/db/games';
import { normalizeStoreShape, writeSuggestedStore, writeHomeTopicsStore } from '@/src/db/caches';

/* One-time persistence bootstrap, ported from server.js.
 *
 * The legacy Express app ran this once at boot (ensureDataDirs, load users,
 * seed the default admin, and — with Postgres — run the schema + migrations).
 * Next has no single boot step, so we memoize it and every route awaits it
 * before doing work. */

let readyPromise: Promise<void> | null = null;

// Reject after `ms` so a hanging DB connection can't exceed the serverless
// function timeout — on timeout we downgrade to file storage instead of crashing.
function bootTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`DB bootstrap timed out after ${ms}ms`)), ms)
  );
}

async function bootstrapPersistence(): Promise<void> {
  // Resolve where file-storage lives (project dir, else /tmp) before any read/write.
  ensureDataDirs();
  // Load any existing file-storage users into the shared in-memory holder.
  userState.users = readJSON('users.json', []);

  if (!db.pool) {
    if (!Array.isArray(userState.users) || !userState.users.length) {
      userState.users = [makeUser('admin', '123456', 'admin')];
      writeJSON('users.json', userState.users);
      console.log('Seeded default admin user (admin / 123456)');
    }
    return;
  }

  try {
    // Bound the whole DB init/migration so a slow or unreachable Postgres (common on
    // serverless with a non-pooled connection) fails fast and downgrades to file
    // storage rather than hanging until the function times out.
    await Promise.race([bootTimeout(6000), (async () => {
    await initDatabase();

    let dbUsers = await loadUsers();
    if (!dbUsers.length) {
      const fileUsers = readJSON('users.json', []);
      if (Array.isArray(fileUsers) && fileUsers.length) {
        await persistUsers(fileUsers);
        dbUsers = await loadUsers();
        console.log(`Migrated ${fileUsers.length} user(s) from JSON to Postgres.`);
      } else {
        const seeded = [makeUser('admin', '123456', 'admin')];
        await persistUsers(seeded);
        dbUsers = seeded;
        console.log('Seeded default admin user (admin / 123456) in Postgres');
      }
    }
    userState.users = dbUsers;

    const gameCount = await dbQuery('SELECT COUNT(*)::int AS count FROM games');
    const totalGames = gameCount.rows?.[0]?.count || 0;
    if (!totalGames) {
      const fileGames = readJSON('games.json', []);
      let migratedGames = 0;
      for (const g of Array.isArray(fileGames) ? fileGames : []) {
        try {
          await insertGame({
            id: String(g.id || crypto.randomUUID()),
            shareId: String(g.shareId || g.id || crypto.randomUUID()),
            shareUrl: String(g.shareUrl || ''),
            username: String(g.username || ''),
            finishedAt: g.finishedAt || new Date().toISOString(),
            finishedDate: g.finishedDate || '',
            finishedTime: g.finishedTime || '',
            topic: g.topic || '',
            concept: g.concept || '',
            level: g.level || '',
            settings: g.settings || null,
            slides: g.slides || null,
            correct: Number.isFinite(g.correct) ? g.correct : 0,
            total: Number.isFinite(g.total) ? g.total : 0,
            durationSec: Number.isFinite(g.durationSec) ? g.durationSec : 0,
            recommendations: g.recommendations || null,
            questionSummary: g.questionSummary || null,
            answerSummary: g.answerSummary || null,
            aiNotes: g.aiNotes || null,
          });
          migratedGames++;
        } catch {
          // Skip malformed records or records tied to unknown users.
        }
      }
      if (migratedGames) console.log(`Migrated ${migratedGames} game record(s) from JSON to Postgres.`);
    }

    const suggestedCount = await dbQuery('SELECT COUNT(*)::int AS count FROM suggested_topics_cache');
    if (!(suggestedCount.rows?.[0]?.count || 0)) {
      const suggestedFile = normalizeStoreShape(
        readJSON(SUGGESTED_STORE_FILE, { defaults: DEFAULT_SUGGESTION_PAIR, users: {} }),
        DEFAULT_SUGGESTION_PAIR
      );
      if (Object.keys(suggestedFile.users || {}).length) await writeSuggestedStore(suggestedFile);
    }

    const homeCount = await dbQuery('SELECT COUNT(*)::int AS count FROM home_topics_cache');
    if (!(homeCount.rows?.[0]?.count || 0)) {
      const homeFile = normalizeStoreShape(
        readJSON(HOME_TOPICS_STORE_FILE, { defaults: DEFAULT_HOME_TOPIC_POOL, users: {} }),
        DEFAULT_HOME_TOPIC_POOL
      );
      if (Object.keys(homeFile.users || {}).length) await writeHomeTopicsStore(homeFile);
    }
    })()]);
  } catch (e: any) {
    // DB configured but unreachable/slow at boot: don't crash — run on file storage so
    // the site stays up and saves still work (see insertGame's file fallback).
    console.error('Database bootstrap failed; falling back to file storage for this run:', e.message);
    try { await db.pool?.end(); } catch { /* ignore */ }
    db.pool = null;
    if (!Array.isArray(userState.users) || !userState.users.length) {
      userState.users = [makeUser('admin', '123456', 'admin')];
      writeJSON('users.json', userState.users);
      console.log('Seeded default admin user (admin / 123456)');
    }
  }
}

export function ensureReady(): Promise<void> {
  if (!readyPromise) readyPromise = bootstrapPersistence();
  return readyPromise;
}
