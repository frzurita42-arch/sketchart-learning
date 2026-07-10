/* SketchLearn server: thin bootstrap.
 * Loads config, wires the db/ai/slide modules, mounts the route modules, and
 * starts the server. All feature logic lives in src/. */
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// ---------- config (env, provider flags, constants) — required first ----------
const {
  PORT, ROOT_DIR,
  SUGGESTED_STORE_FILE, HOME_TOPICS_STORE_FILE,
  DEFAULT_SUGGESTION_PAIR, DEFAULT_HOME_TOPIC_POOL,
  GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL, IMAGE_API_KEY, IMAGE_API_MODEL,
  ANTHROPIC_MODEL, geminiEnabled, deepseekEnabled, claudeSvgEnabled
} = require('./src/config');

// ---------- db (pool holder, file storage, users, games, caches) ----------
const { db, dbQuery } = require('./src/db/pool');
const { readJSON, writeJSON, ensureDataDirs, initDatabase } = require('./src/db/persistence');
const { userState, makeUser, loadUsers, persistUsers } = require('./src/db/users');
const { insertGame } = require('./src/db/games');
const { normalizeStoreShape, writeSuggestedStore, writeHomeTopicsStore } = require('./src/db/caches');

// ---------- route modules ----------
const authRoutes = require('./src/routes/auth.routes');
const gamesRoutes = require('./src/routes/games.routes');
const aiRoutes = require('./src/routes/ai.routes');
const staticRoutes = require('./src/routes/static.routes');

// Resolve where file-storage lives (project dir, else /tmp) before any read/write.
ensureDataDirs();

// Load any existing file-storage users into the shared in-memory holder.
userState.users = readJSON('users.json', []);

const app = express();
app.use(express.json({ limit: '2mb' }));
// Don't let express.static auto-serve index.html — we serve a cache-busted copy below.
// JS/CSS get Cache-Control: no-cache so ES-module imports (which bypass the index
// ?v= rewrite) always revalidate after a deploy; ETag makes that a cheap 304.
app.use(express.static(path.join(ROOT_DIR, 'public'), {
  index: false,
  setHeaders(res, filePath) {
    if (/\.(?:js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
// serve the vendored KaTeX build (CSS, JS, fonts) for offline LaTeX rendering
app.use('/vendor/katex', express.static(path.join(ROOT_DIR, 'node_modules', 'katex', 'dist')));

// API + report routers, then the SPA catch-all last.
app.use(authRoutes);
app.use(gamesRoutes);
app.use(aiRoutes);
app.use(staticRoutes);

async function bootstrapPersistence() {
  if (!db.pool) {
    if (!Array.isArray(userState.users) || !userState.users.length) {
      userState.users = [makeUser('admin', '123456', 'admin')];
      writeJSON('users.json', userState.users);
      console.log('Seeded default admin user (admin / 123456)');
    }
    return;
  }

  try {
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
          aiNotes: g.aiNotes || null
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
  } catch (e) {
    // DB configured but unreachable/slow at boot: don't crash — run on file storage so
    // the site stays up and saves still work (see insertGame's file fallback).
    console.error('Database bootstrap failed; falling back to file storage for this run:', e.message);
    try { await db.pool.end(); } catch { /* ignore */ }
    db.pool = null;
    if (!Array.isArray(userState.users) || !userState.users.length) {
      userState.users = [makeUser('admin', '123456', 'admin')];
      writeJSON('users.json', userState.users);
      console.log('Seeded default admin user (admin / 123456)');
    }
  }
}

async function startServer() {
  await bootstrapPersistence();
  app.listen(PORT, () => {
    console.log(`SketchLearn running on http://localhost:${PORT}`);
    console.log(`Persistence: ${db.pool ? 'Postgres' : 'JSON files'}`);
    console.log(`Lesson text: ${geminiEnabled ? `Gemini (${GEMINI_TEXT_MODEL})${deepseekEnabled ? ' with DeepSeek failover' : ''}` : 'DeepSeek'}`);
    const illus = claudeSvgEnabled ? `Claude SVG (${ANTHROPIC_MODEL})`
      : (IMAGE_API_KEY ? `AI images (${IMAGE_API_MODEL})`
        : (geminiEnabled ? `AI images (${GEMINI_IMAGE_MODEL})` : "the text model's own SVG"));
    console.log(`Slide illustrations: ${illus}`);
    if (!geminiEnabled && !deepseekEnabled) console.warn('WARNING: no text provider set — set GEMINI_API_KEY or DEEPSEEK_API_KEY in .env. AI features will fail.');
  });
}

startServer().catch((e) => {
  console.error('Failed to start SketchLearn:', e.message);
  process.exit(1);
});
