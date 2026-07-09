/* SketchLearn server: auth + JSON storage + DeepSeek AI proxy */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// ---------- tiny .env loader (no dependency needed) ----------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
let DATA_DIR = path.join(__dirname, 'data');
let GEN_DIR = path.join(DATA_DIR, 'generated');
const SUGGESTED_STORE_FILE = 'suggested_topics.json';
const HOME_TOPICS_STORE_FILE = 'home_topics.json';

const GLOBAL_TREND_SEEDS = [
  'AI safety and alignment',
  'Climate adaptation systems',
  'Public health data literacy',
  'Space economy basics',
  'Cybersecurity for citizens',
  'Water resilience engineering',
  'Energy storage breakthroughs',
  'Misinformation detection methods',
  'Food security analytics',
  'Disaster response logistics'
];

const DEFAULT_SUGGESTION_PAIR = [
  {
    topic: 'Climate adaptation systems',
    why: 'This connects real global pressure points to practical problem-solving skills that stay relevant over time.',
    honorableMentions: ['Water resilience engineering', 'Disaster response logistics', 'Energy storage breakthroughs'],
    settings: {
      level: 'Upper Intermediate',
      totalSlides: 7,
      paragraphLength: 'medium',
      paragraphCount: 3,
      tone: 'friendly lecture',
      complexity: 'standard',
      imageDensity: 'balanced'
    },
    customMessage: 'Frame each slide around a real-world constraint and end with one actionable solution step.'
  },
  {
    topic: 'Misinformation detection methods',
    why: 'This sharpens critical thinking for current-event information overload and teaches decision-quality habits.',
    honorableMentions: ['Public health data literacy', 'AI safety and alignment', 'Cybersecurity for citizens'],
    settings: {
      level: 'Lower Intermediate',
      totalSlides: 6,
      paragraphLength: 'brief',
      paragraphCount: 3,
      tone: 'Socratic questioning',
      complexity: 'standard',
      imageDensity: 'mostly-text'
    },
    customMessage: 'Use one current headline-style claim per slide and test it with a simple verification checklist.'
  }
];

const DEFAULT_HOME_TOPIC_POOL = [
  'Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Literature', 'Programming',
  'Economics', 'Music Theory', 'Astronomy', 'Psychology', 'Climate adaptation systems',
  'Public health data literacy', 'Cybersecurity for citizens', 'Energy storage breakthroughs',
  'Water resilience engineering', 'Food security analytics', 'Disaster response logistics',
  'Misinformation detection methods', 'Data storytelling', 'Systems thinking', 'AI safety and alignment', 'Space economy basics'
];

function hasConfiguredKey(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return !/(your[-_ ]?key|sk-your-key-here|replace-me|placeholder)/i.test(v);
}

let canPersistFiles = true;

function ensureDataDirs() {
  const candidates = [
    path.join(__dirname, 'data'),
    path.join('/tmp', 'sketchlearn-data')
  ];
  for (const dir of candidates) {
    try {
      const gen = path.join(dir, 'generated');
      fs.mkdirSync(gen, { recursive: true });
      DATA_DIR = dir;
      GEN_DIR = gen;
      return;
    } catch {
      // try the next candidate
    }
  }
  canPersistFiles = false;
}

const dbEnabled = hasConfiguredKey(DATABASE_URL);
const pgPool = dbEnabled
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
    })
  : null;

async function dbQuery(text, params = []) {
  if (!pgPool) throw new Error('Database is not configured');
  return pgPool.query(text, params);
}

async function initDatabase() {
  if (!pgPool) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      share_id TEXT UNIQUE NOT NULL,
      share_url TEXT,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      finished_at TIMESTAMPTZ NOT NULL,
      finished_date TEXT,
      finished_time TEXT,
      topic TEXT,
      concept TEXT,
      level TEXT,
      settings JSONB,
      slides JSONB,
      correct INTEGER,
      total INTEGER,
      duration_sec INTEGER,
      recommendations JSONB,
      question_summary JSONB,
      answer_summary JSONB,
      ai_notes JSONB
    )
  `);
  await dbQuery('CREATE INDEX IF NOT EXISTS idx_games_username_finished_at ON games(username, finished_at DESC)');
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS suggested_topics_cache (
      username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      pair JSONB NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      last_shown_topic TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trigger_topic TEXT
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS home_topics_cache (
      username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      topics JSONB NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trigger_topic TEXT
    )
  `);
}

ensureDataDirs();

function parseModelJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty JSON response from model');

  // Some providers occasionally wrap JSON in ```json code fences.
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const extractBalanced = (src) => {
    const firstObj = src.indexOf('{');
    const firstArr = src.indexOf('[');
    const start = (firstObj === -1) ? firstArr : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
    if (start === -1) return null;
    const open = src[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return null;
  };

  const candidates = [unfenced, extractBalanced(unfenced)].filter(Boolean);
  let lastErr = null;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch (e) { lastErr = e; }
  }
  throw new Error(`Model returned invalid JSON: ${lastErr ? lastErr.message : 'parse failed'}`);
}

// ---------- JSON file storage ----------
function readJSON(file, fallback) {
  if (!canPersistFiles) return fallback;
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  if (!canPersistFiles) return;
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

let users = readJSON('users.json', []);

function normalizeStoreShape(store, defaults) {
  const next = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(next.defaults) || !next.defaults.length) next.defaults = defaults;
  if (!next.users || typeof next.users !== 'object') next.users = {};
  return next;
}

async function loadUsers() {
  if (!pgPool) {
    return Array.isArray(users) ? users : [];
  }
  const { rows } = await dbQuery('SELECT username, salt, password_hash, role, created_at FROM users ORDER BY created_at ASC');
  return rows.map(r => ({
    username: r.username,
    salt: r.salt,
    passwordHash: r.password_hash,
    role: r.role,
    createdAt: new Date(r.created_at).toISOString()
  }));
}

async function persistUsers(nextUsers) {
  users = nextUsers;
  if (!pgPool) {
    writeJSON('users.json', nextUsers);
    return;
  }
  const client = await pgPool.connect();
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

async function readGames() {
  if (!pgPool) return readJSON('games.json', []);
  const { rows } = await dbQuery('SELECT * FROM games ORDER BY finished_at ASC');
  return rows.map(r => ({
    id: r.id,
    shareId: r.share_id,
    shareUrl: r.share_url,
    username: r.username,
    finishedAt: new Date(r.finished_at).toISOString(),
    finishedDate: r.finished_date,
    finishedTime: r.finished_time,
    topic: r.topic,
    concept: r.concept,
    level: r.level,
    settings: r.settings,
    slides: r.slides,
    correct: r.correct,
    total: r.total,
    durationSec: r.duration_sec,
    recommendations: r.recommendations,
    questionSummary: r.question_summary,
    answerSummary: r.answer_summary,
    aiNotes: r.ai_notes
  }));
}

async function insertGame(record) {
  if (!pgPool) {
    const games = readJSON('games.json', []);
    games.push(record);
    writeJSON('games.json', games);
    return;
  }
  await dbQuery(
    `INSERT INTO games (
      id, share_id, share_url, username, finished_at, finished_date, finished_time,
      topic, concept, level, settings, slides, correct, total, duration_sec,
      recommendations, question_summary, answer_summary, ai_notes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19
    )`,
    [
      record.id,
      record.shareId,
      record.shareUrl,
      record.username,
      record.finishedAt,
      record.finishedDate,
      record.finishedTime,
      record.topic,
      record.concept,
      record.level,
      record.settings || null,
      record.slides || null,
      record.correct,
      record.total,
      record.durationSec,
      record.recommendations || null,
      record.questionSummary || null,
      record.answerSummary || null,
      record.aiNotes || null
    ]
  );
}

async function deleteGameRecord(gameId) {
  if (!pgPool) {
    const games = readJSON('games.json', []);
    const before = games.length;
    const next = games.filter(g => g.id !== gameId && g.shareId !== gameId);
    if (next.length === before) return false;
    writeJSON('games.json', next);
    return true;
  }
  const { rowCount } = await dbQuery('DELETE FROM games WHERE id = $1 OR share_id = $1', [gameId]);
  return rowCount > 0;
}

async function recentUserGames(username, limit = 20) {
  if (!pgPool) {
    return readJSON('games.json', [])
      .filter(g => g.username === username)
      .slice(-limit);
  }
  const { rows } = await dbQuery(
    'SELECT * FROM games WHERE username = $1 ORDER BY finished_at DESC LIMIT $2',
    [username, Math.max(1, parseInt(limit, 10) || 20)]
  );
  return rows.reverse().map(r => ({
    id: r.id,
    shareId: r.share_id,
    shareUrl: r.share_url,
    username: r.username,
    finishedAt: new Date(r.finished_at).toISOString(),
    finishedDate: r.finished_date,
    finishedTime: r.finished_time,
    topic: r.topic,
    concept: r.concept,
    level: r.level,
    settings: r.settings,
    slides: r.slides,
    correct: r.correct,
    total: r.total,
    durationSec: r.duration_sec,
    recommendations: r.recommendations,
    questionSummary: r.question_summary,
    answerSummary: r.answer_summary,
    aiNotes: r.ai_notes
  }));
}

function buildBaseUrl(req) {
  const host = req.get('host');
  return `${req.protocol}://${host}`;
}

function pickRandom(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

function isValidSuggestion(item) {
  return !!(item && typeof item === 'object' && String(item.topic || '').trim());
}

async function readSuggestedStore() {
  const fallback = { defaults: DEFAULT_SUGGESTION_PAIR, users: {} };
  if (pgPool) {
    const { rows } = await dbQuery('SELECT username, pair, cursor, last_shown_topic, updated_at, trigger_topic FROM suggested_topics_cache');
    const usersMap = {};
    for (const r of rows) {
      usersMap[r.username] = {
        pair: Array.isArray(r.pair) ? r.pair : DEFAULT_SUGGESTION_PAIR,
        cursor: Number.isInteger(r.cursor) ? r.cursor : 0,
        lastShownTopic: r.last_shown_topic || null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        triggerTopic: r.trigger_topic || null
      };
    }
    return { defaults: DEFAULT_SUGGESTION_PAIR, users: usersMap };
  }
  const store = readJSON(SUGGESTED_STORE_FILE, fallback);
  return normalizeStoreShape(store, DEFAULT_SUGGESTION_PAIR);
}

async function writeSuggestedStore(store) {
  const normalized = normalizeStoreShape(store, DEFAULT_SUGGESTION_PAIR);
  if (!pgPool) {
    writeJSON(SUGGESTED_STORE_FILE, normalized);
    return;
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM suggested_topics_cache');
    for (const [username, entry] of Object.entries(normalized.users || {})) {
      await client.query(
        `INSERT INTO suggested_topics_cache (username, pair, cursor, last_shown_topic, updated_at, trigger_topic)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          username,
          JSON.stringify(Array.isArray(entry.pair) ? entry.pair : DEFAULT_SUGGESTION_PAIR),
          Number.isInteger(entry.cursor) ? entry.cursor : 0,
          entry.lastShownTopic || null,
          entry.updatedAt || new Date().toISOString(),
          entry.triggerTopic || null
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function readHomeTopicsStore() {
  const fallback = { defaults: DEFAULT_HOME_TOPIC_POOL, users: {} };
  if (pgPool) {
    const { rows } = await dbQuery('SELECT username, topics, cursor, updated_at, trigger_topic FROM home_topics_cache');
    const usersMap = {};
    for (const r of rows) {
      usersMap[r.username] = {
        topics: Array.isArray(r.topics) ? r.topics : DEFAULT_HOME_TOPIC_POOL,
        cursor: Number.isInteger(r.cursor) ? r.cursor : 0,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        triggerTopic: r.trigger_topic || null
      };
    }
    return { defaults: DEFAULT_HOME_TOPIC_POOL, users: usersMap };
  }
  const store = readJSON(HOME_TOPICS_STORE_FILE, fallback);
  return normalizeStoreShape(store, DEFAULT_HOME_TOPIC_POOL);
}

async function writeHomeTopicsStore(store) {
  const normalized = normalizeStoreShape(store, DEFAULT_HOME_TOPIC_POOL);
  if (!pgPool) {
    writeJSON(HOME_TOPICS_STORE_FILE, normalized);
    return;
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM home_topics_cache');
    for (const [username, entry] of Object.entries(normalized.users || {})) {
      await client.query(
        `INSERT INTO home_topics_cache (username, topics, cursor, updated_at, trigger_topic)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          username,
          JSON.stringify(Array.isArray(entry.topics) ? entry.topics : DEFAULT_HOME_TOPIC_POOL),
          Number.isInteger(entry.cursor) ? entry.cursor : 0,
          entry.updatedAt || new Date().toISOString(),
          entry.triggerTopic || null
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function normalizeTopicPool(list, fallbackPool) {
  const raw = Array.isArray(list) ? list : [];
  const cleaned = raw
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  return cleaned.length ? cleaned : fallbackPool.slice();
}

function rotatePickFromList(list, count, avoidSet = new Set(), startCursor = 0) {
  const pool = Array.isArray(list) ? list : [];
  if (!pool.length) return { items: [], nextCursor: 0 };
  const filtered = pool.filter(v => !avoidSet.has(String(v || '').toLowerCase()));
  const source = filtered.length >= Math.min(count, pool.length) ? filtered : pool;
  if (!source.length) return { items: [], nextCursor: 0 };

  const want = Math.min(source.length, Math.max(1, count));
  const out = [];
  const cursorBase = ((startCursor % source.length) + source.length) % source.length;
  for (let i = 0; i < want; i++) out.push(source[(cursorBase + i) % source.length]);
  const step = Math.max(1, Math.floor(want / 2));
  const nextCursor = (cursorBase + step) % source.length;
  return { items: out, nextCursor };
}

function rotatePickSuggestionFromPair(pair, avoidSet = new Set(), startCursor = 0) {
  const valid = (Array.isArray(pair) ? pair : []).filter(isValidSuggestion);
  if (!valid.length) return { item: null, nextCursor: 0 };
  const preferred = valid.filter(v => !avoidSet.has(String(v.topic || '').toLowerCase()));
  const source = preferred.length ? preferred : valid;
  const cursorBase = ((startCursor % source.length) + source.length) % source.length;
  return { item: source[cursorBase], nextCursor: (cursorBase + 1) % source.length };
}

function randomPickSuggestionNoRepeat(pair, avoidSet = new Set(), lastShownTopic = '') {
  const valid = (Array.isArray(pair) ? pair : []).filter(isValidSuggestion);
  if (!valid.length) return null;
  const preferred = valid.filter(v => !avoidSet.has(String(v.topic || '').toLowerCase()));
  const source = preferred.length ? preferred : valid;
  if (!source.length) return null;

  const last = String(lastShownTopic || '').trim().toLowerCase();
  let candidates = source;
  if (last && source.length > 1) {
    const withoutLast = source.filter(v => String(v.topic || '').trim().toLowerCase() !== last);
    if (withoutLast.length) candidates = withoutLast;
  }
  return candidates[Math.floor(Math.random() * candidates.length)] || source[0];
}

function makeFallbackPair(avoidSet = new Set(), anchorTopic = '') {
  const picked = [];
  const seedPool = [...GLOBAL_TREND_SEEDS];
  const maybeAnchor = String(anchorTopic || '').trim();
  if (maybeAnchor && !avoidSet.has(maybeAnchor.toLowerCase())) picked.push(maybeAnchor);
  for (const s of seedPool) {
    if (picked.length >= 2) break;
    if (avoidSet.has(s.toLowerCase())) continue;
    if (picked.some(v => v.toLowerCase() === s.toLowerCase())) continue;
    picked.push(s);
  }
  while (picked.length < 2) picked.push(GLOBAL_TREND_SEEDS[picked.length] || DEFAULT_SUGGESTION_PAIR[0].topic);

  return picked.slice(0, 2).map((topic, idx) => ({
    topic,
    why: 'This aligns your recent interests with current global challenges and focuses on practical problem-solving skills.',
    honorableMentions: GLOBAL_TREND_SEEDS.filter(v => v.toLowerCase() !== topic.toLowerCase()).slice(0, 3),
    settings: idx === 0 ? {
      level: 'Upper Intermediate',
      totalSlides: 7,
      paragraphLength: 'medium',
      paragraphCount: 3,
      tone: 'friendly lecture',
      complexity: 'standard',
      imageDensity: 'balanced'
    } : {
      level: 'Lower Intermediate',
      totalSlides: 6,
      paragraphLength: 'brief',
      paragraphCount: 3,
      tone: 'Socratic questioning',
      complexity: 'standard',
      imageDensity: 'mostly-text'
    },
    customMessage: 'Tie each explanation to one current event signal and one concrete action a learner could take.'
  }));
}

function normalizeSuggestion(raw, fallback, avoidSet) {
  const topic = String(raw?.topic || '').trim();
  const normalizedTopic = topic && !avoidSet.has(topic.toLowerCase()) ? topic : fallback.topic;
  const honorable = Array.isArray(raw?.honorableMentions)
    ? raw.honorableMentions.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  return {
    topic: normalizedTopic,
    why: String(raw?.why || '').trim() || fallback.why,
    honorableMentions: (honorable.length ? honorable : fallback.honorableMentions)
      .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i)
      .slice(0, 3),
    settings: {
      level: String(raw?.settings?.level || fallback.settings.level).trim() || fallback.settings.level,
      totalSlides: Math.min(20, Math.max(2, parseInt(raw?.settings?.totalSlides, 10) || fallback.settings.totalSlides)),
      paragraphLength: ['brief', 'medium', 'detailed'].includes(raw?.settings?.paragraphLength) ? raw.settings.paragraphLength : fallback.settings.paragraphLength,
      paragraphCount: Math.min(7, Math.max(1, parseInt(raw?.settings?.paragraphCount, 10) || fallback.settings.paragraphCount)),
      tone: String(raw?.settings?.tone || fallback.settings.tone).trim() || fallback.settings.tone,
      complexity: ['simple', 'standard', 'scholarly'].includes(raw?.settings?.complexity) ? raw.settings.complexity : fallback.settings.complexity,
      imageDensity: ['text-only', 'mostly-text', 'balanced', 'mostly-visual'].includes(raw?.settings?.imageDensity) ? raw.settings.imageDensity : fallback.settings.imageDensity
    },
    customMessage: String(raw?.customMessage || '').trim() || fallback.customMessage
  };
}

function pickSuggestionFromPair(pair, avoidSet) {
  const valid = (Array.isArray(pair) ? pair : []).filter(isValidSuggestion);
  const preferred = valid.filter(v => !avoidSet.has(String(v.topic || '').toLowerCase()));
  return pickRandom(preferred.length ? preferred : valid);
}

// ---------- users ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, salt, passwordHash: hashPassword(password, salt), role, createdAt: new Date().toISOString() };
}

// ---------- sessions (signed stateless auth tokens) ----------
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || DATABASE_URL || 'local-dev-session-secret';
const AUTH_TOKEN_TTL_SEC = Math.max(300, parseInt(process.env.AUTH_TOKEN_TTL_SEC, 10) || (60 * 60 * 24 * 30));

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

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// serve the vendored KaTeX build (CSS, JS, fonts) for offline LaTeX rendering
app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist')));

// Optional: Google Gemini. One key powers BOTH the lesson text (replacing DeepSeek)
// and real generated images (Gemini's native image models). Set GEMINI_API_KEY to use it.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const geminiEnabled = hasConfiguredKey(GEMINI_API_KEY);
const deepseekEnabled = hasConfiguredKey(DEEPSEEK_API_KEY);

// Optional image-generation backend (see .env.example). Priority: an explicit
// OpenAI-compatible image provider, else Gemini's image model, else no images.
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;
const IMAGE_API_URL = process.env.IMAGE_API_URL || 'https://api.openai.com/v1/images/generations';
const IMAGE_API_MODEL = process.env.IMAGE_API_MODEL || 'gpt-image-1';
const imageEnabled = hasConfiguredKey(IMAGE_API_KEY) || geminiEnabled;

// Optional: use Anthropic's Claude to DRAW each slide's SVG (Claude writes far more
// accurate, well-labelled sketch diagrams than a text model). DeepSeek still writes
// the lesson text + quiz; when a key is set, Claude illustrates each slide fresh,
// using that slide's concept, level, and the learner's progress. Falls back to
// DeepSeek's own SVG when unset.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const claudeSvgEnabled = !!ANTHROPIC_API_KEY;

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = verifyAuthToken(token);
    if (!payload) return res.status(401).json({ error: 'Not signed in' });
    const username = payload.u;
    req.user = users.find(u => u.username === username) || null;
    if (!req.user && pgPool) {
      users = await loadUsers();
      req.user = users.find(u => u.username === username) || null;
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

// ---------- auth endpoints ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (pgPool) users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const now = Math.floor(Date.now() / 1000);
  const token = signAuthToken({ u: user.username, iat: now, exp: now + AUTH_TOKEN_TTL_SEC, v: 1 });
  res.json({ token, username: user.username, role: user.role });
});

app.post('/api/logout', auth, (req, res) => {
  // Stateless tokens cannot be revoked server-side without a deny-list store.
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ---------- user management ----------
app.get('/api/users', auth, adminOnly, async (req, res) => {
  const games = await readGames();
  res.json(users.map(u => ({
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    gamesPlayed: games.filter(g => g.username === u.username).length
  })));
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (users.some(u => u.username === username)) return res.status(409).json({ error: 'User already exists' });
  users.push(makeUser(username.trim(), password, role === 'admin' ? 'admin' : 'user'));
  await persistUsers(users);
  res.json({ ok: true });
});

app.post('/api/users/:username/password', auth, async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (req.user.username !== username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only change your own password' });
  }
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: 'No such user' });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.salt);
  await persistUsers(users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', auth, adminOnly, async (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  const before = users.length;
  users = users.filter(u => u.username !== username);
  if (users.length === before) return res.status(404).json({ error: 'No such user' });
  await persistUsers(users);
  res.json({ ok: true });
});

// ---------- game records ----------
app.post('/api/games', auth, async (req, res) => {
  const shareId = String(req.body.shareId || crypto.randomUUID()).trim();
  const shareUrl = String(req.body.shareUrl || `${buildBaseUrl(req)}/report/${shareId}`).trim();
  const record = {
    id: crypto.randomUUID(),
    shareId,
    shareUrl,
    username: req.user.username,
    finishedAt: new Date().toISOString(),
    finishedDate: new Date().toLocaleDateString('en-US'),
    finishedTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    topic: req.body.topic,
    concept: req.body.concept,
    level: req.body.level,
    settings: req.body.settings,
    slides: req.body.slides,       // per-slide question, chosen answer, correct?
    correct: req.body.correct,
    total: req.body.total,
    durationSec: req.body.durationSec,
    recommendations: req.body.recommendations || null,
    questionSummary: req.body.questionSummary || null,
    answerSummary: req.body.answerSummary || null,
    aiNotes: req.body.aiNotes || null
  };
  await insertGame(record);
  res.json({ ok: true, id: record.id, shareId: record.shareId, shareUrl: record.shareUrl, finishedAt: record.finishedAt });
});

app.get('/api/games', auth, async (req, res) => {
  const games = await readGames();
  res.json(req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username));
});

app.get('/api/games/export.csv', auth, async (req, res) => {
  const games = await readGames();
  const mine = req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['user', 'date', 'time', 'topic', 'concept', 'level', 'correct', 'total', 'score_pct', 'duration_sec', 'question_summary', 'answer_summary', 'ai_notes', 'share_url']];
  for (const g of mine) {
    rows.push([
      g.username,
      g.finishedDate || g.finishedAt,
      g.finishedTime || '',
      g.topic,
      g.concept,
      g.level,
      g.correct,
      g.total,
      g.total ? Math.round(100 * g.correct / g.total) : 0,
      g.durationSec,
      Array.isArray(g.questionSummary) ? g.questionSummary.join(' | ') : (g.questionSummary || ''),
      Array.isArray(g.answerSummary) ? g.answerSummary.join(' | ') : (g.answerSummary || ''),
      Array.isArray(g.aiNotes) ? g.aiNotes.join(' | ') : (g.aiNotes || ''),
      g.shareUrl || ''
    ]);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sketchlearn-progress.csv"');
  res.send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

app.delete('/api/games/:gameId', auth, adminOnly, async (req, res) => {
  const deleted = await deleteGameRecord(req.params.gameId);
  if (!deleted) return res.status(404).json({ error: 'No such game' });
  res.json({ ok: true });
});

app.get('/report/:shareId', async (req, res) => {
  const games = await readGames();
  const game = games.find(g => g.shareId === req.params.shareId || g.id === req.params.shareId);
  if (!game) return res.status(404).send('<h1>Report not found</h1>');

  const esc = v => String(v ?? '').replace(/[&<>\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const notes = Array.isArray(game.aiNotes) ? game.aiNotes : (game.aiNotes ? [game.aiNotes] : []);
  const recs = game.recommendations || {};
  const dateTime = `${esc(game.finishedDate || new Date(game.finishedAt).toLocaleDateString())} ${esc(game.finishedTime || new Date(game.finishedAt).toLocaleTimeString())}`;

  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SketchLearn Report</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f7f3e9;color:#2d2a26;margin:0;padding:24px;}
    .card{max-width:1100px;margin:0 auto;background:#fffdf6;border:2px solid #2d2a26;border-radius:24px;padding:20px;box-shadow:3px 4px 0 rgba(45,42,38,.25)}
    h1,h2{margin:0 0 12px} h1{font-size:30px} h2{font-size:22px;margin-top:18px}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:14px 0}
    .pill{border:1px solid #2d2a26;border-radius:999px;padding:8px 12px;background:#fff}
    .grid{display:grid;grid-template-columns:1.4fr .8fr;gap:18px} .box{background:#fff;border:1px solid #2d2a26;border-radius:18px;padding:14px}
    table{width:100%;border-collapse:collapse;background:#fff;overflow:auto} th,td{border:1px solid #2d2a26;padding:8px;vertical-align:top;text-align:left} th{background:#fadf63}
    .muted{opacity:.8} .notes li{margin-bottom:6px} a{color:#5c80bc} .list{margin:6px 0 0 20px}
    @media (max-width:900px){.grid{grid-template-columns:1fr}}
  </style></head><body><div class="card">
    <h1>SketchLearn Progress Report</h1>
    <div class="muted">Shared link created on ${dateTime}</div>
    <div class="meta">
      <div class="pill"><b>Student</b><br>${esc(game.username)}</div>
      <div class="pill"><b>Topic</b><br>${esc(game.topic)}</div>
      <div class="pill"><b>Concept</b><br>${esc(game.concept)}</div>
      <div class="pill"><b>Level</b><br>${esc(game.level)}</div>
      <div class="pill"><b>Score</b><br>${esc(game.correct)}/${esc(game.total)}</div>
      <div class="pill"><b>Time</b><br>${Math.floor((game.durationSec || 0) / 60)}:${String((game.durationSec || 0) % 60).padStart(2, '0')}</div>
    </div>
    <div class="grid">
      <div class="box">
        <h2>Summary</h2>
        <p><b>Coach summary:</b> ${esc(recs.summary || 'No coach summary saved.')}</p>
        <h2>Question Table</h2>
        <div style="overflow:auto"><table>
          <tr><th>#</th><th>Question</th><th>Answer</th><th>Result</th><th>Misconception / note</th></tr>
          ${(game.slides || []).map((s, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(s.question)}</td>
            <td>${esc(s.chosen)}</td>
            <td>${s.correct ? 'Correct' : 'Wrong'}</td>
            <td>${esc(s.misconception || '')}</td>
          </tr>`).join('') || '<tr><td colspan="5">No slide data.</td></tr>'}
        </table></div>
      </div>
      <div class="box">
        <h2>AI Notes</h2>
        <ul class="notes">${notes.length ? notes.map(n => `<li>${esc(n)}</li>`).join('') : '<li>No AI notes saved.</li>'}</ul>
        ${Array.isArray(recs.recommendations) && recs.recommendations.length ? `<h2>Recommendations</h2><ul class="notes">${recs.recommendations.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${Array.isArray(recs.nextConcepts) && recs.nextConcepts.length ? `<h2>Try next</h2><ul class="notes">${recs.nextConcepts.map(n => `<li>${esc(n.name)}${n.level ? ` (${esc(n.level)})` : ''}</li>`).join('')}</ul>` : ''}
        <p><b>Share URL</b><br><a href="${esc(game.shareUrl || '')}">${esc(game.shareUrl || '')}</a></p>
      </div>
    </div>
  </div></body></html>`);
});

// ---------- DeepSeek helpers ----------
async function deepseek(messages, { json = true, temperature = 0.8, maxTokens = 4096 } = {}) {
  if (!deepseekEnabled) throw new Error('DEEPSEEK_API_KEY is not configured. Set a real key in .env.');
  let lastParseErr = null;
  for (let attempt = 0; attempt < (json ? 4 : 1); attempt++) {
    const attemptMaxTokens = json ? Math.min(12288, Math.round(maxTokens * Math.pow(1.6, attempt))) : maxTokens;
    const body = {
      model: 'deepseek-chat',
      messages,
      temperature: attempt === 0 ? temperature : 0.2,
      max_tokens: attemptMaxTokens
    };
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from DeepSeek');
    if (!json) return content;
    try {
      return parseModelJson(content);
    } catch (e) {
      lastParseErr = e;
    }
  }
  throw lastParseErr || new Error('Model returned invalid JSON');
}

// Google Gemini text generation (OpenAI-style messages translated to Gemini's shape).
async function gemini(messages, { json = true, temperature = 0.8, maxTokens = 4096 } = {}) {
  if (!geminiEnabled) throw new Error('GEMINI_API_KEY is not configured. Set a real key in .env.');
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }]
  }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: String(messages[messages.length - 1]?.content || '') }] });
  let lastParseErr = null;
  for (let attempt = 0; attempt < (json ? 4 : 1); attempt++) {
    const attemptMaxTokens = json ? Math.min(12288, Math.round(maxTokens * Math.pow(1.6, attempt))) : maxTokens;
    const body = {
      contents,
      generationConfig: {
        temperature: attempt === 0 ? temperature : 0.2,
        maxOutputTokens: attemptMaxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) {
        throw new Error('Gemini API quota/rate limit hit (429). This is usually per-model or per-minute quota for this API key/project, not your overall billing balance.');
      }
      if (res.status === 503) {
        throw new Error('Gemini service is temporarily overloaded (503). Please retry in a moment.');
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts.map(p => p.text).filter(Boolean).join('');
    if (!content) throw new Error('Empty response from Gemini');
    if (!json) return content;
    try {
      return parseModelJson(content);
    } catch (e) {
      lastParseErr = e;
    }
  }
  throw lastParseErr || new Error('Model returned invalid JSON');
}

// Text-provider dispatcher with failover: Gemini first, then DeepSeek on quota/outage.
async function generateText(messages, opts) {
  if (geminiEnabled) {
    try {
      return await gemini(messages, opts);
    } catch (e) {
      const msg = String(e && e.message || '');
      const shouldFailover = /quota|rate limit|429|overloaded|503/i.test(msg);
      if (shouldFailover && deepseekEnabled) {
        console.warn('Gemini unavailable; falling back to DeepSeek for this request.');
        return deepseek(messages, opts);
      }
      throw e;
    }
  }
  if (!deepseekEnabled) {
    throw new Error('No AI provider key is configured. Set GEMINI_API_KEY or DEEPSEEK_API_KEY in environment variables.');
  }
  return deepseek(messages, opts);
}

async function generateStructured(messages, opts = {}, { attempts = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await generateText(messages, {
        ...opts,
        json: true,
        temperature: i === 0 ? (opts.temperature ?? 0.8) : 0.2,
        maxTokens: Math.min(12288, Math.round((opts.maxTokens || 4096) * Math.pow(1.5, i)))
      });
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || '');
      // Retry only when the model output is malformed/truncated JSON.
      if (!/invalid JSON|Unterminated string|Unexpected end of JSON input|JSON/i.test(msg)) break;
    }
  }
  throw lastErr || new Error('Could not generate structured JSON');
}

function makeFallbackLearningPath(topic, wantedLevels) {
  const normalizedTopic = String(topic || 'General studies').trim() || 'General studies';
  const templates = {
    Beginner: ['Core vocabulary', 'Big-picture overview', 'Everyday examples', 'Common misconceptions'],
    'Lower Intermediate': ['Cause and effect', 'Key frameworks', 'Simple data interpretation', 'Practical decisions'],
    'Upper Intermediate': ['Trade-offs and constraints', 'Comparative analysis', 'Scenario planning', 'Structured critique'],
    Advanced: ['Systems interactions', 'Edge cases', 'Method evaluation', 'Implementation strategy'],
    PhD: ['Research gaps', 'Competing theories', 'Experimental design', 'Future directions']
  };

  return {
    topic: normalizedTopic,
    overview: `This fallback path introduces ${normalizedTopic} step by step and focuses on practical understanding. It can be used while AI providers are temporarily unavailable.`,
    levels: wantedLevels.map((level) => ({
      level,
      description: `Focused progression for ${normalizedTopic} at ${level} level.`,
      concepts: (templates[level] || templates.Beginner).map((name, idx) => ({
        name: `${normalizedTopic}: ${name}`,
        blurb: `Concept ${idx + 1} for ${level} mastery`
      }))
    }))
  };
}

function makeFallbackLevelConcepts(topic, level, wanted, avoidConcepts = []) {
  const normalizedTopic = String(topic || 'General studies').trim() || 'General studies';
  const avoidSet = new Set((Array.isArray(avoidConcepts) ? avoidConcepts : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const seeds = [
    'Foundations and key terms',
    'Trade-offs and constraints',
    'Practical workflow',
    'Common mistakes and fixes',
    'Evidence and measurement',
    'Case study and reflection',
    'Comparison with alternatives',
    'Implementation checklist'
  ];
  const concepts = [];
  for (const seed of seeds) {
    const name = `${normalizedTopic}: ${seed}`;
    if (avoidSet.has(name.toLowerCase())) continue;
    concepts.push({
      name,
      blurb: `Fallback concept for ${level} practice`
    });
    if (concepts.length >= wanted) break;
  }
  return {
    level,
    description: `Fallback concept refresh for ${normalizedTopic} at ${level} level.`,
    concepts
  };
}

function makeFallbackSlide({ topic, concept, level, settings = {}, slideNumber, totalSlides, branch }) {
  const paragraphWords = { brief: '40-60', medium: '70-100', detailed: '110-150' }[settings.paragraphLength] || '70-100';
  const titleBase = String(concept || topic || 'Learning concept').trim();
  const title = titleBase.split(/\s+/).slice(0, 8).join(' ');
  const adaptationLine = branch
    ? (branch.correct
      ? 'You answered correctly on the previous step, so this slide goes a level deeper.'
      : `This slide targets a common misconception: ${String(branch.misconception || 'mixing up the core idea with a related one')}.`)
    : 'This slide builds a strong baseline before moving to harder cases.';

  const isTimeTravel = /time\s*travel|\bfuture\b|\bpast\b|\bpresent\b|headline|news/i.test(`${topic} ${concept} ${settings.customInstructions || ''}`);
  const components = [
    { type: 'text', content: `At ${level} level, this step focuses on ${concept}. The goal is to connect the idea to real choices, constraints, and outcomes, not just memorize definitions. Read each paragraph and look for cause-effect logic you can reuse in new situations. (${paragraphWords} style)` },
    { type: 'text', content: `${adaptationLine} Use the topic context (${topic}) to ask: what changes, what stays stable, and what evidence would confirm your interpretation? This comparison mindset prevents shallow pattern matching and improves transfer to unfamiliar examples.` },
    { type: 'text', content: `Before the next slide, summarize the concept in one sentence, then test it on a small scenario. If your explanation predicts outcomes and trade-offs, your understanding is likely solid; if not, revisit the key mechanism and assumptions.` }
  ];

  if (isTimeTravel) {
    if (slideNumber % 2 === 0) {
      components.push({
        type: 'table',
        headers: ['Dimension', 'Past', 'Present', 'Future'],
        rows: [
          ['Main pressure', 'Resource scarcity', 'Infrastructure strain', 'Interplanetary coordination'],
          ['Decision lens', 'Stability first', 'Risk balancing', 'Long-horizon resilience'],
          ['Best metric', 'Survival rate', 'Service reliability', `Treaty compliance (slide ${slideNumber})`]
        ],
        caption: `Time-travel comparison frame for slide ${slideNumber}`
      });
    } else {
      components.push({
        type: 'svg',
        caption: `Feedback loop from policy to infrastructure outcomes (slide ${slideNumber})`,
        svg: `<svg viewBox="0 0 420 220" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="18" width="120" height="48" rx="10" fill="#f7f3e9" stroke="#2d2a26" stroke-width="2.5"/><text x="28" y="48" font-size="14" fill="#2d2a26">Policy choice</text><rect x="150" y="18" width="120" height="48" rx="10" fill="#f7f3e9" stroke="#2d2a26" stroke-width="2.5"/><text x="170" y="48" font-size="14" fill="#2d2a26">Resource flow</text><rect x="284" y="18" width="120" height="48" rx="10" fill="#f7f3e9" stroke="#2d2a26" stroke-width="2.5"/><text x="300" y="48" font-size="14" fill="#2d2a26">System impact</text><path d="M136 42 L150 42" stroke="#2d2a26" stroke-width="2.5"/><path d="M270 42 L284 42" stroke="#2d2a26" stroke-width="2.5"/><path d="M344 66 C344 120, 74 120, 74 66" fill="none" stroke="#5c80bc" stroke-width="2.5"/><polygon points="69,70 74,58 79,70" fill="#5c80bc"/><rect x="92" y="132" width="238" height="62" rx="10" fill="#fffbe8" stroke="#2d2a26" stroke-width="2.5"/><text x="108" y="158" font-size="14" fill="#2d2a26">Review metric: reliability, fairness, sustainability</text><text x="108" y="178" font-size="14" fill="#2d2a26">Then adjust the next policy cycle</text></svg>`
      });
    }
  }

  return {
    title,
    summary: `Fallback slide ${slideNumber}/${totalSlides} reinforcing ${concept} at ${level} level while AI providers are unavailable.`,
    components,
    quiz: {
      question: `Which strategy best shows real understanding of ${concept}?`,
      options: [
        {
          text: 'Apply the concept to a new scenario and justify assumptions',
          correct: true,
          explanation: 'Correct. Transfer to a new case with explicit assumptions shows durable understanding.',
          misconception: ''
        },
        {
          text: 'Memorize terms without testing them in context',
          correct: false,
          explanation: 'Definitions help, but context-free memorization usually breaks under variation.',
          misconception: 'Assumes recall is the same as understanding'
        },
        {
          text: 'Skip constraints and focus only on ideal outcomes',
          correct: false,
          explanation: 'Ignoring constraints leads to unrealistic conclusions and weak decisions.',
          misconception: 'Treats simplified models as complete reality'
        },
        {
          text: 'Pick the first plausible interpretation and move on',
          correct: false,
          explanation: 'Fast intuition is useful, but untested interpretations often hide errors.',
          misconception: 'Confuses plausibility with verification'
        }
      ]
    }
  };
}

function makeFallbackRecommendation({ topic, concept, level, correct, total, slides = [] }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCorrect = Math.max(0, Number(correct) || 0);
  const ratio = safeCorrect / safeTotal;
  const questionSummary = slides.map(s => String(s.question || '').trim()).filter(Boolean).slice(0, 3);
  const answerSummary = slides.map(s => String(s.chosen || '').trim()).filter(Boolean).slice(0, 3);
  const nextLevelMap = {
    Beginner: 'Lower Intermediate',
    'Lower Intermediate': 'Upper Intermediate',
    'Upper Intermediate': 'Advanced',
    Advanced: 'PhD',
    PhD: 'PhD'
  };
  const nextLevel = nextLevelMap[level] || level || 'Upper Intermediate';
  const summary = ratio >= 0.75
    ? `Strong work on ${concept}. Your score suggests you are ready to deepen accuracy and speed on more complex variants.`
    : `You are building momentum on ${concept}. A short targeted review should make your next attempt much more stable.`;

  return {
    summary,
    questionSummary,
    answerSummary,
    aiNotes: [
      `Current focus: ${topic} / ${concept} at ${level}.`,
      'Fallback coaching is active because AI providers are temporarily unavailable.',
      'Use one quick recap and one new example before replaying the activity.'
    ],
    recommendations: [
      'Rewrite the core idea in one sentence and list two assumptions.',
      'Practice one new scenario and explain trade-offs out loud.',
      'Replay with medium paragraph length and balanced visuals for retention.'
    ],
    nextConcepts: [
      { name: `${concept}: applied scenario analysis`, level: nextLevel },
      { name: `${concept}: edge cases and failure modes`, level: nextLevel }
    ]
  };
}

function makeFallbackCoachReply(progress = []) {
  const recent = Array.isArray(progress) ? progress.slice(-3) : [];
  if (!recent.length) {
    return 'I can still coach you while AI providers are offline. Start with a Beginner or Lower Intermediate concept, keep slides to 6-8, and use balanced visuals. After your first run, I can help you tune difficulty and pacing.';
  }
  const latest = recent[recent.length - 1];
  return `I can still coach you while AI providers are offline. Your latest activity was ${latest.topic} / ${latest.concept} at ${latest.level} with score ${latest.score}. Next, keep the same topic, lower complexity one step if accuracy was low, and run 6-8 slides with balanced visuals. Then retry at your original level.`;
}

// Strip anything executable from AI-generated SVG before it reaches the browser.
function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return '';
  let out = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
  const start = out.indexOf('<svg');
  const end = out.lastIndexOf('</svg>');
  if (start === -1 || end === -1) return '';
  return out.slice(start, end + 6);
}
function sanitizeComponents(components) {
  if (!Array.isArray(components)) return [];
  return components.map(c => {
    if (c && c.type === 'svg') c.svg = sanitizeSvg(c.svg);
    if (c && c.type === 'table') {
      const headers = Array.isArray(c.headers) ? c.headers.map(v => String(v || '').trim()).filter(Boolean).slice(0, 8) : [];
      const rows = Array.isArray(c.rows)
        ? c.rows
            .map(r => Array.isArray(r) ? r.map(v => String(v || '').trim()).slice(0, Math.max(1, headers.length || 4)) : null)
            .filter(Boolean)
            .slice(0, 8)
        : [];
      c.headers = headers;
      c.rows = rows;
      c.caption = String(c.caption || '').trim();
    }
    return c;
  }).filter(c => {
    if (!c || !c.type) return false;
    if (c.type === 'svg') return !!c.svg;
    if (c.type === 'code') return !!c.content;
    if (c.type === 'latex') return !!c.content;
    if (c.type === 'image') return !!(c.url || c.prompt);
    if (c.type === 'table') return Array.isArray(c.headers) && c.headers.length > 0 && Array.isArray(c.rows) && c.rows.length > 0;
    return true;
  });
}

function componentVisualSignature(component) {
  if (!component || !component.type) return '';
  const clean = (v) => String(v || '').trim().toLowerCase();
  if (component.type === 'table') {
    const headers = Array.isArray(component.headers) ? component.headers.join('|') : '';
    const firstRow = Array.isArray(component.rows) && component.rows[0] ? component.rows[0].join('|') : '';
    const secondRow = Array.isArray(component.rows) && component.rows[1] ? component.rows[1].join('|') : '';
    return `table:${clean(component.caption)}::${clean(headers)}::${clean(firstRow)}::${clean(secondRow)}`.slice(0, 260);
  }
  if (component.type === 'svg') {
    const svgLead = clean(String(component.svg || '').replace(/\s+/g, ' ').slice(0, 120));
    return `svg:${clean(component.caption)}::${svgLead}`.slice(0, 260);
  }
  if (component.type === 'image') {
    const urlHead = clean(String(component.url || '').slice(0, 180));
    return `image:${clean(component.caption || component.prompt || component.alt)}::${clean(component.prompt || '')}::${urlHead}`.slice(0, 320);
  }
  if (component.type === 'latex') return `latex:${clean(component.caption || '')}::${clean(component.content || '')}`.slice(0, 260);
  if (component.type === 'code') return `code:${clean(component.language)}:${clean(String(component.content || '').split('\n')[0])}`.slice(0, 220);
  return '';
}

function enforceSlideVisualPolicy(slide, history = [], slideNumber = 1) {
  const visualTypes = new Set(['table']);
  const normalizeSig = (value) => String(value || '')
    .toLowerCase()
    .replace(/slide\s*\d+/g, 'slide')
    .replace(/data-slide\s*=\s*['"]?\d+['"]?/g, 'data-slide')
    .replace(/\s+/g, ' ')
    .trim();
  const previous = new Set(
    (Array.isArray(history) ? history : [])
      .flatMap(h => Array.isArray(h?.visualRefs) ? h.visualRefs : [])
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const previousCanonical = new Set([...previous].map(normalizeSig).filter(Boolean));
  const previousTypes = new Set(
    [...previous]
      .map(v => String(v).split(':')[0])
      .filter(Boolean)
  );

  const components = Array.isArray(slide.components) ? slide.components : [];
  const visualIndexes = components
    .map((c, idx) => ({ c, idx, sig: componentVisualSignature(c) }))
    .filter(x => visualTypes.has(x.c?.type));

  if (visualIndexes.length > 1) {
    const preferred =
      visualIndexes.find(v => v.sig && !previousCanonical.has(normalizeSig(v.sig))) ||
      visualIndexes.find(v => !previousTypes.has(String(v.c?.type || '').toLowerCase())) ||
      visualIndexes[0];
    slide.components = components.filter((_, idx) => !visualIndexes.some(v => v.idx === idx) || idx === preferred.idx);
  }

  const oneVisual = (slide.components || []).find(c => visualTypes.has(c?.type));
  if (!oneVisual) return;

  const sig = componentVisualSignature(oneVisual).toLowerCase();
  const sigCanonical = normalizeSig(sig);
  const repeatProneType = ['table', 'svg'].includes(String(oneVisual.type || '').toLowerCase())
    && previousTypes.has(String(oneVisual.type || '').toLowerCase());
  if (!sig || (!previousCanonical.has(sigCanonical) && !repeatProneType)) return;

  const titleSeed = String(slide.title || 'this concept').trim();
  const quizSeed = String(slide?.quiz?.question || '').trim().slice(0, 90);

  // Ensure uniqueness when a repeated visual slips through by adjusting the component content.
  if (oneVisual.type === 'table' && Array.isArray(oneVisual.rows)) {
    const width = Math.max(2, (oneVisual.headers || []).length || 4);
    const forcedRow = [
      `Slide ${slideNumber}: ${titleSeed}`,
      quizSeed || 'Key signal',
      'Distinct trade-off',
      'Best decision for this quiz'
    ].slice(0, width);
    if (!Array.isArray(oneVisual.rows)) oneVisual.rows = [];
    oneVisual.rows = [forcedRow, ...oneVisual.rows].slice(0, 8);
    if (!Array.isArray(oneVisual.headers) || !oneVisual.headers.length) {
      oneVisual.headers = ['Scenario', 'Signal', 'Trade-off', 'Decision'].slice(0, width);
    }
    oneVisual.caption = `Slide ${slideNumber}: ${String(oneVisual.caption || 'comparison table').trim()}`;
    return;
  }
  if (oneVisual.type === 'latex') {
    oneVisual.caption = `Slide ${slideNumber}: ${String(oneVisual.caption || 'Formula').trim()}`;
    return;
  }
  if (oneVisual.type === 'code') {
    const base = String(oneVisual.content || '').trim();
    oneVisual.content = `// slide ${slideNumber} variant\n${base}`;
  }
}

function inferTimeEraHint(text = '') {
  const t = String(text || '').toLowerCase();
  if (/future|futur|2050|2060|2070|2080|2090|2100|tomorrow|next decade|next century/.test(t)) return 'future';
  if (/past|ancient|medieval|renaissance|victorian|historical|century ago|1800|1900|retro|old city/.test(t)) return 'past';
  if (/present|today|current|modern|now|contemporary/.test(t)) return 'present';
  return 'present';
}

function buildTimeTravelImagePrompt(slide, context = {}) {
  const texts = (Array.isArray(slide?.components) ? slide.components : [])
    .filter(c => c?.type === 'text')
    .map(c => String(c.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2);
  const narrative = [
    String(slide?.title || '').trim(),
    String(slide?.summary || '').trim(),
    String(slide?.quiz?.question || '').trim(),
    ...texts
  ].filter(Boolean).join(' ');

  const era = inferTimeEraHint(`${context.topic || ''} ${context.concept || ''} ${narrative} ${context.customInstructions || ''}`);
  const eraDirection = era === 'future'
    ? 'FUTURE setting: use plausible futuristic architecture, transport, clothing, interfaces, and infrastructure.'
    : era === 'past'
      ? 'PAST setting: use historically accurate architecture, materials, clothing, tools, transport, and signage.'
      : 'PRESENT setting: use realistic current-day architecture, technology, transport, and public spaces.';

  return [
    'NANO BANANA style educational illustration for a Time Travel learning slide.',
    `Topic: ${context.topic || ''}. Concept: ${context.concept || ''}.`,
    `This is slide ${context.slideNumber || 1} of ${context.totalSlides || '?'}.`,
    `Slide focus: ${narrative.slice(0, 700)}`,
    eraDirection,
    'Make this scene composition clearly different from earlier slides in the same activity.',
    'The scene must directly visualize the concept in this story and support answering the slide quiz.',
    'No anachronisms: all visual details must match the selected time period accurately.',
    'Cinematic but classroom-safe, clear composition, high detail, no text overlays, no logos.'
  ].join(' ');
}

function enforceTimeTravelImagePolicy(slide, context = {}) {
  if (!slide || !Array.isArray(slide.components)) return;
  const visualTypes = new Set(['table', 'svg', 'image', 'latex', 'code']);
  const imagePrompt = buildTimeTravelImagePrompt(slide, context);
  const nonVisual = slide.components.filter(c => !visualTypes.has(c?.type));
  const imageComp = {
    type: 'image',
    prompt: imagePrompt,
    frame: context.slideNumber % 2 === 0 ? 'polaroid' : 'paper',
    caption: `${String((inferTimeEraHint(imagePrompt) || 'present')).toUpperCase()} scene: Slide ${context.slideNumber || 1} - ${String(slide.title || context.concept || 'Time Travel concept').trim()}`
  };

  // Keep exactly one primary visual for Time Travel: the generated image.
  const firstTextIdx = nonVisual.findIndex(c => c?.type === 'text');
  if (firstTextIdx >= 0) {
    nonVisual.splice(firstTextIdx + 1, 0, imageComp);
  } else {
    nonVisual.unshift(imageComp);
  }
  slide.components = nonVisual;
}

function buildGenericImagePrompt(slide, context = {}) {
  const texts = (Array.isArray(slide?.components) ? slide.components : [])
    .filter(c => c?.type === 'text')
    .map(c => String(c.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return [
    'NANO BANANA style educational illustration.',
    `Topic: ${context.topic || ''}. Concept: ${context.concept || ''}.`,
    `Slide ${context.slideNumber || 1} of ${context.totalSlides || '?'}.`,
    `Title: ${String(slide?.title || '').trim()}. Summary: ${String(slide?.summary || '').trim()}.`,
    `Key content: ${texts.slice(0, 600)}`,
    'Make this image unique vs previous slides and directly useful for answering the quiz.',
    'High clarity, no logos, no text overlays.'
  ].join(' ');
}

function makeFallbackTable(slide, context = {}) {
  const title = String(slide?.title || context.concept || 'Concept').trim();
  const quiz = String(slide?.quiz?.question || 'How do we evaluate this concept?').trim();
  const topic = String(context.topic || slide?.summary || 'Topic').trim();
  return {
    type: 'table',
    headers: ['Category', 'What it shows', 'Why it matters'],
    rows: [
      [topic.slice(0, 28), title.slice(0, 30), `Slide ${context.slideNumber || 1} focus`],
      ['Key question', quiz.slice(0, 30), 'Use the slide evidence to answer it'],
      ['Practical takeaway', String(slide?.summary || '').slice(0, 30), 'This is what the learner should remember']
    ],
    caption: `Slide ${context.slideNumber || 1} comparison table`
  };
}

function enforceVisualCyclePolicy(slide, context = {}) {
  if (!slide || !Array.isArray(slide.components)) return;
  if (context.imageDensity === 'text-only') return;

  // Keep generated slides text-first when the requested output should not include charts or SVG.
  slide.components = Array.isArray(slide.components)
    ? slide.components.filter(c => c && c.type !== 'svg' && c.type !== 'image')
    : slide.components;
}

// Generate one image. Prefers an OpenAI-compatible provider, else Gemini's image model.
async function generateImage(prompt) {
  if (IMAGE_API_KEY) {
    try {
      const res = await fetch(IMAGE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IMAGE_API_KEY}` },
        body: JSON.stringify({ model: IMAGE_API_MODEL, prompt, size: '1024x1024', n: 1 })
      });
      if (!res.ok) { console.error('Image API error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
      const data = await res.json();
      const item = data.data && data.data[0];
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item?.url) return item.url;
    } catch (e) { console.error('Image generation failed:', e.message); }
    return null;
  }
  if (geminiEnabled) return geminiImage(prompt);
  return null;
}

// Gemini native image generation (returns a base64 data URL).
async function geminiImage(prompt) {
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });
    if (!res.ok) { console.error('Gemini image error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const img = parts.find(p => p.inlineData?.data || p.inline_data?.data);
    const inline = img && (img.inlineData || img.inline_data);
    if (inline?.data) return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
  } catch (e) { console.error('Gemini image generation failed:', e.message); }
  return null;
}

function escXml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fallbackImageDataUrl(prompt = '', caption = '') {
  const era = inferTimeEraHint(`${prompt} ${caption}`);
  const palette = era === 'future'
    ? { bg: '#e8f3ff', accent: '#5c80bc', ink: '#17324d' }
    : era === 'past'
      ? { bg: '#f7efe1', accent: '#a36a2c', ink: '#3b2611' }
      : { bg: '#edf6ef', accent: '#3f8a58', ink: '#173223' };
  const eraLabel = era.toUpperCase();
  const a = escXml(String(caption || 'Time Travel scene').slice(0, 72));
  const b = escXml(String(prompt).replace(/\s+/g, ' ').trim().slice(0, 96));
  const c = escXml(String(prompt).replace(/\s+/g, ' ').trim().slice(96, 190));
  let hash = 0;
  const seedSource = `${prompt}|${caption}`;
  for (let i = 0; i < seedSource.length; i++) hash = ((hash << 5) - hash + seedSource.charCodeAt(i)) | 0;
  hash = Math.abs(hash);
  const h1 = 130 + (hash % 180);
  const h2 = 160 + ((hash >> 3) % 220);
  const h3 = 140 + ((hash >> 5) % 200);
  const c1 = 700 - ((hash >> 2) % 100);
  const c2 = 690 - ((hash >> 4) % 100);
    const variant = hash % 3;
    const scene = variant === 0
     ? `<circle cx="180" cy="390" r="42" fill="${palette.accent}" opacity="0.35"/>
       <circle cx="270" cy="360" r="26" fill="${palette.accent}" opacity="0.2"/>
       <path d="M120 830 L260 690 L380 830" />`
     : variant === 1
      ? `<path d="M120 380 L420 300 L760 430" />
        <path d="M120 430 L420 350 L760 480" opacity="0.7"/>
        <rect x="760" y="300" width="110" height="80" rx="10" fill="${palette.accent}" opacity="0.25"/>`
      : `<rect x="120" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>
        <rect x="235" y="360" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.2"/>
        <rect x="350" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="${a}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect x="56" y="56" width="912" height="912" rx="28" fill="none" stroke="${palette.accent}" stroke-width="10"/>
  <text x="84" y="130" font-family="Georgia, serif" font-size="42" fill="${palette.ink}">NANO BANANA ${eraLabel} SCENE</text>
  <text x="84" y="196" font-family="Georgia, serif" font-size="34" fill="${palette.ink}">${a}</text>
  <text x="84" y="252" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${b}</text>
  <text x="84" y="290" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${c}</text>
  <g stroke="${palette.ink}" stroke-width="7" fill="none" opacity="0.85">${scene}</g>
  <g stroke="${palette.ink}" stroke-width="8" fill="none" opacity="0.9">
    <path d="M110 ${c1} C 250 ${c1 - 120}, 380 ${c1 - 110}, 520 ${c1}"/>
    <path d="M500 ${c2} C 640 ${c2 - 120}, 760 ${c2 - 110}, 900 ${c2}"/>
    <rect x="180" y="${860 - h1}" width="170" height="${h1}" rx="8" fill="${palette.accent}" opacity="0.2"/>
    <rect x="390" y="${860 - h2}" width="220" height="${h2}" rx="8" fill="${palette.accent}" opacity="0.16"/>
    <rect x="660" y="${860 - h3}" width="170" height="${h3}" rx="8" fill="${palette.accent}" opacity="0.2"/>
  </g>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Turn any {type:"image", prompt} components into real images; drop ones that fail.
async function fillImages(components) {
  for (const c of components) {
    if (c && c.type === 'image' && !c.url && c.prompt) {
      c.url = await generateImage(`${c.prompt}. Educational illustration in a hand-drawn sketch / paper-collage style, muted warm palette (paper cream, soft orange, green, blue), clear and uncluttered.`);
      if (!c.url) c.url = fallbackImageDataUrl(c.prompt, c.caption);
      delete c.prompt;
    }
  }
  return components.filter(c => !(c && c.type === 'image' && !c.url));
}

// Ask Claude (Anthropic Messages API) to DRAW one concept-accurate SVG for a slide.
// `brief` describes exactly what this slide teaches; `context` carries the concept,
// level and recent history so the drawing stays consistent with the lesson's progress.
async function generateSvgWithClaude(brief, context = {}) {
  if (!claudeSvgEnabled) return null;
  const historyLine = (context.history && context.history.length)
    ? `The lesson so far: ${context.history.map(h => h.title).filter(Boolean).join(' → ')}.`
    : 'This is the first slide of the lesson.';
  const prompt = `You are illustrating ONE slide of a "${context.topic}" lesson for a ${context.level} learner. The current concept is "${context.concept}". ${historyLine}

Draw a single self-contained SVG that ACCURATELY depicts what THIS slide teaches:
"""
${brief}
"""

Requirements:
- Return ONLY the <svg>...</svg> markup, nothing else — no prose, no code fences, no markdown.
- One <svg> with a viewBox around "0 0 400 260". No <script>, no external images, no <foreignObject>, no href to anything but "#".
- Hand-sketched style: stroke="#2d2a26" stroke-width="2.5" stroke-linecap="round", slightly irregular strokes. Fills ONLY from this palette: #f9a03f orange, #7fb069 green, #5c80bc blue, #e4572e red, #f7f3e9 paper, #fadf63 yellow.
- The drawing must genuinely illustrate the SPECIFIC idea (a real diagram/graph/labeled figure or clear visual metaphor), NOT a generic decorative shape. Label the important parts with <text> (font-size 14 or larger).
- Build on the earlier slides where it helps continuity, but this drawing must stand on its own for the current concept.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) { console.error('Anthropic SVG error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
    const data = await res.json();
    const text = Array.isArray(data.content)
      ? data.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : '';
    const svg = sanitizeSvg(text);
    return svg || null;
  } catch (e) { console.error('Claude SVG generation failed:', e.message); return null; }
}

// Replace (or add) a slide's SVG with a Claude-drawn one, using the slide's own
// text as the drawing brief so the illustration matches the lesson exactly.
async function illustrateWithClaude(slide, context) {
  if (!claudeSvgEnabled) return;
  const brief = [
    slide.title,
    slide.summary,
    ...(slide.components || []).filter(c => c.type === 'text').map(c => c.content),
    ...(slide.components || []).filter(c => c.type === 'definition').map(c => `${c.term}: ${c.content}`)
  ].filter(Boolean).join(' ').slice(0, 1500);

  const svg = await generateSvgWithClaude(brief, context);
  if (!svg) return; // keep DeepSeek's own svg (if any) on failure
  const caption = slide.components?.find(c => c.type === 'svg')?.caption || '';
  // drop DeepSeek's svg components, then add Claude's illustration once
  slide.components = (slide.components || []).filter(c => c.type !== 'svg');
  slide.components.push({ type: 'svg', svg, caption, drawnBy: 'claude' });
}

// Persist every AI generation to a JSON file, as the site's content source of record.
function saveGeneration(kind, id, payload) {
  try {
    const dir = path.join(GEN_DIR, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(payload, null, 2));
  } catch (e) { console.error('Could not save generation:', e.message); }
}

const SKETCH_SVG_RULES = `SVG rules: self-contained <svg> with a viewBox (around 0 0 400 260), no external references, no scripts, no <text> smaller than 14px. Draw in a hand-sketched style: stroke-based shapes with stroke="#2d2a26" stroke-width="2.5" stroke-linecap="round", slightly irregular lines, fills only from this palette: #f9a03f (orange), #7fb069 (green), #5c80bc (blue), #e4572e (red), #f7f3e9 (paper), #fadf63 (yellow). CRITICAL: the drawing must accurately depict THIS slide's specific concept — a real diagram, labeled figure, graph, or visual metaphor of what the paragraphs explain. Label its parts with <text> so a viewer can map the picture onto the idea. A generic, decorative, or unrelated shape (a plain circle, a random zig-zag) is unacceptable; if the concept is a process show the steps, if it is a relationship show the axes/quantities, if it is a structure show and name the parts.`;

// ---------- AI: learning path ----------
app.post('/api/ai/path', auth, async (req, res) => {
  const { topic, guidance, levels, fromHistory, freshSeed } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const allLevels = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
  const wanted = Array.isArray(levels) && levels.length ? allLevels.filter(l => levels.includes(l)) : allLevels;

  // When refreshing from history, feed the learner's recent activity so the path adapts.
  let historyLine = '';
  if (fromHistory) {
    const games = readJSON('games.json', []).filter(g => g.username === req.user.username).slice(-15);
    if (games.length) {
      historyLine = '\nThe learner has recently studied (adapt the path to build on strengths and shore up weak spots, and suggest fresh concepts they have NOT yet seen):\n' +
        games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): scored ${g.correct}/${g.total}`).join('\n');
    } else {
      historyLine = '\nThe learner has no history yet — give a well-rounded introductory path.';
    }
  }

  try {
    if (!geminiEnabled && !deepseekEnabled) {
      const fallback = makeFallbackLearningPath(topic, wanted);
      return res.json({ ...fallback, fallback: true });
    }
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a curriculum designer. Given a study topic, produce a learning path as JSON with this exact schema:
{"topic": string, "overview": string (2 sentences max), "levels": [{"level": string, "description": string (1 sentence), "concepts": [{"name": string, "blurb": string (max 15 words)}]}]}
Include ONLY these levels, in this order: ${wanted.join(', ')}. Give 4-6 concrete, teachable concepts per level, ordered from first-to-learn to last. Respond with JSON only.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}` + (guidance ? `\nLearner guidance/request (adapt the path to this): ${guidance}` : '') + historyLine +
          (freshSeed ? `\n(Offer a genuinely fresh selection of concepts this time — vary them from a typical default. Variation token: ${freshSeed}.)` : '')
      }
    ], { temperature: fromHistory || freshSeed ? 0.95 : 0.7, maxTokens: 4096 });
    const id = crypto.randomUUID();
    saveGeneration('paths', id, { username: req.user.username, topic, guidance, result, createdAt: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

async function generateHomeTopicPoolForUser(username, { avoid = [], triggerTopic = '', poolSize = 24 } = {}) {
  const games = await recentUserGames(username, 30);
  const learned = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-20);
  const avoidList = Array.isArray(avoid) ? avoid.map(String).filter(Boolean).slice(0, 50) : [];
  const wantedPool = Math.min(36, Math.max(18, parseInt(poolSize, 10) || 24));

  const result = await generateStructured([
    {
      role: 'system',
      content: `Return JSON only:
{"topics":[{"name":string,"why":string}]}
Rules:
- Exactly ${wantedPool} topics.
- Blend learner interests with current global trends.
- Favor practical, problem-solving learning themes.
- Topic names must be short, classroom-safe, and distinct.`
    },
    {
      role: 'user',
      content: `Trigger topic from home interaction (if any): ${triggerTopic || 'none'}\n\nLearner recent studies:\n${learned.join('\n') || 'none yet'}\n\nCurrent trend seeds:\n${GLOBAL_TREND_SEEDS.join('\n')}\n\nAvoid these topic names:\n${avoidList.join('\n') || 'none'}`
    }
  ], { temperature: 0.74, maxTokens: 2200 });

  return normalizeTopicPool((result.topics || []).map(t => t.name), DEFAULT_HOME_TOPIC_POOL);
}

async function refreshHomeTopicPoolForUser(username, options = {}, store = null) {
  const activeStore = store || await readHomeTopicsStore();
  const pool = await generateHomeTopicPoolForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    topics: pool,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null
  };
  await writeHomeTopicsStore(activeStore);
  saveGeneration('home-topics', crypto.randomUUID(), { username, options, topics: pool, createdAt: new Date().toISOString() });
  return pool;
}

function queueHomeTopicPoolRefresh(username, options = {}) {
  setTimeout(() => {
    refreshHomeTopicPoolForUser(username, options).catch(e => {
      console.error('Background home-topic refresh failed:', e.message);
    });
  }, 0);
}

// ---------- AI: topic suggestions for the home chips (fast cache + rotating window) ----------
app.post('/api/ai/topics', auth, async (req, res) => {
  const { count = 12, avoid = [], refresh = false, triggerTopic = '' } = req.body || {};
  const wanted = Math.min(20, Math.max(6, parseInt(count, 10) || 12));
  const avoidSet = new Set((Array.isArray(avoid) ? avoid : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readHomeTopicsStore();

  if (refresh) {
    try {
      const pool = await refreshHomeTopicPoolForUser(req.user.username, { avoid, triggerTopic, poolSize: 24 }, store);
      const entry = store.users[req.user.username] || { topics: pool, cursor: 0 };
      const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
      entry.cursor = rotated.nextCursor;
      store.users[req.user.username] = entry;
      await writeHomeTopicsStore(store);
      return res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: false, poolUpdated: true });
    } catch {
      const rotated = rotatePickFromList(store.defaults || DEFAULT_HOME_TOPIC_POOL, wanted, avoidSet, 0);
      return res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: true, poolUpdated: false });
    }
  }

  const userEntry = store.users[req.user.username] || null;
  const pool = normalizeTopicPool(userEntry?.topics, normalizeTopicPool(store.defaults, DEFAULT_HOME_TOPIC_POOL));
  const hasUserPool = !!(userEntry && Array.isArray(userEntry.topics) && userEntry.topics.length);

  if (!hasUserPool) {
    store.users[req.user.username] = {
      topics: pool,
      cursor: 0,
      updatedAt: new Date().toISOString(),
      triggerTopic: null
    };
    await writeHomeTopicsStore(store);
    queueHomeTopicPoolRefresh(req.user.username, { avoid, triggerTopic, poolSize: 24 });
  }

  const entry = store.users[req.user.username] || { topics: pool, cursor: 0 };
  const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
  entry.cursor = rotated.nextCursor;
  store.users[req.user.username] = entry;
  await writeHomeTopicsStore(store);
  res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: true, poolUpdated: false });
});

app.post('/api/ai/topics/preload', auth, (req, res) => {
  const { avoid = [], triggerTopic = '' } = req.body || {};
  queueHomeTopicPoolRefresh(req.user.username, { avoid, triggerTopic, poolSize: 24 });
  res.json({ ok: true });
});

async function generateSuggestedPairForUser(username, { avoidTopics = [], triggerTopic = '' } = {}) {
  const games = await recentUserGames(username, 25);
  const recent = games.slice(-12);
  const sameField = [...new Set(recent.map(g => String(g.topic || '').trim()).filter(Boolean))].slice(-8);
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const fallbackPair = makeFallbackPair(avoidSet, triggerTopic || sameField[sameField.length - 1] || '');

  const ai = await generateStructured([
    {
      role: 'system',
      content: `You are a study coach. Return JSON only with this exact schema:
{"suggestions":[{"topic":string,"why":string,"honorableMentions":[string,string,string],"settings":{"level":string,"totalSlides":number,"paragraphLength":"brief"|"medium"|"detailed","paragraphCount":number,"tone":string,"complexity":"simple"|"standard"|"scholarly","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual"},"customMessage":string},{"topic":string,"why":string,"honorableMentions":[string,string,string],"settings":{"level":string,"totalSlides":number,"paragraphLength":"brief"|"medium"|"detailed","paragraphCount":number,"tone":string,"complexity":"simple"|"standard"|"scholarly","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual"},"customMessage":string}]}
Rules:
- Exactly 2 suggestions.
- Gear suggestions toward the learner's recent interests and solving real problems.
- Blend current global events/trends with the learner's progression history.
- Topics must be short, classroom-safe, and distinct.
- "why" must be concise (max 2 sentences).
- settings are recommended defaults and must remain editable in the app.
- totalSlides 2-20 and paragraphCount 1-7.`
    },
    {
      role: 'user',
      content: `Trigger topic from home interaction (if any): ${triggerTopic || 'none'}\n\nLearner recent history:\n${recent.map(g => `- ${g.finishedDate || g.finishedAt}: ${g.topic} / ${g.concept} (${g.level}) score ${g.correct}/${g.total}`).join('\n') || 'none yet'}\n\nInterest progression hints:\n${sameField.join('\n') || 'none'}\n\nCurrent trend seeds to consider:\n${GLOBAL_TREND_SEEDS.join('\n')}\n\nAvoid these topic names:\n${[...avoidSet].join('\n') || 'none'}`
    }
  ], { temperature: 0.78, maxTokens: 2600 });

  const raw = Array.isArray(ai.suggestions) ? ai.suggestions : [];
  const normalized = [0, 1].map(i => normalizeSuggestion(raw[i] || {}, fallbackPair[i], avoidSet));
  const unique = normalized.filter((v, i, arr) => arr.findIndex(x => x.topic.toLowerCase() === v.topic.toLowerCase()) === i);
  if (unique.length < 2) {
    for (const fb of fallbackPair) {
      if (unique.length >= 2) break;
      if (!unique.some(v => v.topic.toLowerCase() === fb.topic.toLowerCase())) unique.push(fb);
    }
  }
  return unique.slice(0, 2);
}

async function refreshSuggestedPairForUser(username, options = {}, store = null) {
  const activeStore = store || await readSuggestedStore();
  const pair = await generateSuggestedPairForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    pair,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    lastShownTopic: String(previous.lastShownTopic || '').trim() || null,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null
  };
  await writeSuggestedStore(activeStore);
  saveGeneration('suggestions', crypto.randomUUID(), {
    username,
    options,
    pair,
    createdAt: new Date().toISOString()
  });
  return pair;
}

function queueSuggestedPairRefresh(username, options = {}) {
  setTimeout(() => {
    refreshSuggestedPairForUser(username, options).catch(e => {
      console.error('Background suggested-topic refresh failed:', e.message);
    });
  }, 0);
}

// ---------- AI: fast suggested topic from JSON preload pair ----------
app.post('/api/ai/suggested-topic', auth, async (req, res) => {
  const { avoidTopics = [], refresh = false, triggerTopic = '' } = req.body || {};
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readSuggestedStore();

  if (refresh) {
    try {
      const pair = await refreshSuggestedPairForUser(req.user.username, { avoidTopics, triggerTopic }, store);
      const entry = store.users[req.user.username] || { pair, lastShownTopic: null };
      const picked = randomPickSuggestionNoRepeat(entry.pair || pair, avoidSet, entry.lastShownTopic) || pair[0] || DEFAULT_SUGGESTION_PAIR[0];
      entry.lastShownTopic = picked.topic;
      store.users[req.user.username] = entry;
      await writeSuggestedStore(store);
      return res.json({ ...picked, cached: false, pairUpdated: true });
    } catch {
      const fallback = makeFallbackPair(avoidSet, triggerTopic)[0];
      return res.json({ ...fallback, cached: true, pairUpdated: false });
    }
  }

  const userPair = Array.isArray(store.users?.[req.user.username]?.pair)
    ? store.users[req.user.username].pair.filter(isValidSuggestion)
    : [];
  const defaults = (Array.isArray(store.defaults) && store.defaults.length)
    ? store.defaults.filter(isValidSuggestion)
    : DEFAULT_SUGGESTION_PAIR;

  const activePair = userPair.length ? userPair : defaults;
  if (!userPair.length) {
    store.users[req.user.username] = {
      pair: activePair.slice(0, 2),
      cursor: 0,
      lastShownTopic: null,
      updatedAt: new Date().toISOString(),
      triggerTopic: null
    };
    await writeSuggestedStore(store);
    queueSuggestedPairRefresh(req.user.username, { avoidTopics, triggerTopic });
  }

  const entry = store.users[req.user.username] || { pair: activePair, lastShownTopic: null };
  const picked = randomPickSuggestionNoRepeat(entry.pair || activePair, avoidSet, entry.lastShownTopic) || activePair[0] || DEFAULT_SUGGESTION_PAIR[0];
  entry.lastShownTopic = picked.topic;
  store.users[req.user.username] = entry;
  await writeSuggestedStore(store);
  res.json({ ...picked, cached: true, pairUpdated: false });
});

// ---------- AI: background preload refresh after home-page interactions ----------
app.post('/api/ai/suggested-topic/preload', auth, (req, res) => {
  const { avoidTopics = [], triggerTopic = '' } = req.body || {};
  queueSuggestedPairRefresh(req.user.username, { avoidTopics, triggerTopic });
  res.json({ ok: true });
});

// ---------- AI: random headline for time-travel news generator ----------
app.post('/api/ai/time-travel-headline', auth, async (req, res) => {
  const { period = 'future', avoidHeadlines = [] } = req.body || {};
  const normalizedPeriod = ['past', 'present', 'future'].includes(String(period).toLowerCase())
    ? String(period).toLowerCase()
    : 'future';
  const avoidSet = new Set((Array.isArray(avoidHeadlines) ? avoidHeadlines : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));

  const fallbackPool = {
    past: [
      'Printing Press Sparks Knowledge Boom Across Europe',
      'Ancient Engineers Race to Rebuild Earthquake-Struck Harbor',
      'Young Astronomers Redraw the Night Sky with New Instruments',
      'City-State Debates First Public Health Rules After Outbreak'
    ],
    present: [
      'Local Grid Uses AI Forecasts to Prevent Blackouts During Heat Wave',
      'Students Track Urban Flood Risks with Open Satellite Data',
      'Community Lab Designs Low-Cost Air Quality Alerts',
      'Hospitals Test New Data Dashboards to Speed Emergency Care'
    ],
    future: [
      'Mars Transit Council Approves First Interplanetary Water Treaty',
      'Floating Cities Deploy Storm-Deflection Fields Ahead of Mega Cyclone',
      'Lunar Farms Rewrite Food Supply Chains for Deep-Space Colonies',
      'Quantum Weather Net Warns Coastal Regions 30 Days Earlier'
    ]
  };

  try {
    const games = await recentUserGames(req.user.username, 20);
    const interests = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-10);
    const result = await generateStructured([
      {
        role: 'system',
        content: `Return JSON only: {"headline":string}
Rules:
- Create one compelling news-style headline.
- The scenario must be in the ${normalizedPeriod}.
- Keep it educational and problem-solving oriented.
- 7-16 words, classroom-safe, no sensational violence.`
      },
      {
        role: 'user',
        content: `Learner interests:\n${interests.join('\n') || 'none yet'}\n\nTrend seeds:\n${GLOBAL_TREND_SEEDS.join('\n')}\n\nAvoid headlines:\n${[...avoidSet].join('\n') || 'none'}`
      }
    ], { temperature: 0.85, maxTokens: 240 });

    const raw = String(result.headline || '').trim();
    if (raw && !avoidSet.has(raw.toLowerCase())) return res.json({ headline: raw });
    throw new Error('Invalid headline');
  } catch {
    const pool = fallbackPool[normalizedPeriod] || fallbackPool.future;
    const candidate = pool.find(h => !avoidSet.has(h.toLowerCase())) || pool[0];
    res.json({ headline: candidate });
  }
});

// ---------- AI: suggested topic + settings for structured explanations ----------
app.post('/api/ai/structured-explanation-suggest', auth, async (req, res) => {
  const { avoidPrompts = [] } = req.body || {};
  const avoidSet = new Set((Array.isArray(avoidPrompts) ? avoidPrompts : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));

  const fallback = {
    prompt: 'Bayes theorem for medical test interpretation',
    exampleType: 'proof',
    level: 'Upper Intermediate',
    tone: 'Friendly lecture',
    complexity: 'standard',
    paragraphLength: 'medium',
    imageDensity: 'balanced',
    totalSlides: 8,
    continuation: 'related-topics',
    alternateVisualMath: true
  };

  try {
    const games = await recentUserGames(req.user.username, 20);
    const interests = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-12);
    const result = await generateStructured([
      {
        role: 'system',
        content: `Return JSON only with this schema:
{"prompt":string,"exampleType":"proof"|"worked-example"|"graph-table"|"tree-diagram"|"outline","level":"Beginner"|"Lower Intermediate"|"Upper Intermediate"|"Advanced"|"PhD","tone":string,"complexity":"simple"|"standard"|"scholarly","paragraphLength":"brief"|"medium"|"detailed","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual","totalSlides":number,"continuation":"more-examples"|"different-examples"|"related-topics","alternateVisualMath":boolean}
Rules:
- Suggest one rigorous but teachable structured-explanation topic.
- It may be math, science, economics, computing, or other structured reasoning domains.
- Include settings that fit the topic and remain editable by the user.
- Keep prompt concise and classroom-safe.`
      },
      {
        role: 'user',
        content: `Learner recent interests:\n${interests.join('\n') || 'none yet'}\n\nAvoid prompts:\n${[...avoidSet].join('\n') || 'none'}`
      }
    ], { temperature: 0.8, maxTokens: 700 });

    const prompt = String(result.prompt || '').trim();
    const out = {
      prompt: (prompt && !avoidSet.has(prompt.toLowerCase())) ? prompt : fallback.prompt,
      exampleType: ['proof', 'worked-example', 'graph-table', 'tree-diagram', 'outline'].includes(result.exampleType) ? result.exampleType : fallback.exampleType,
      level: ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'].includes(result.level) ? result.level : fallback.level,
      tone: String(result.tone || '').trim() || fallback.tone,
      complexity: ['simple', 'standard', 'scholarly'].includes(result.complexity) ? result.complexity : fallback.complexity,
      paragraphLength: ['brief', 'medium', 'detailed'].includes(result.paragraphLength) ? result.paragraphLength : fallback.paragraphLength,
      imageDensity: ['text-only', 'mostly-text', 'balanced', 'mostly-visual'].includes(result.imageDensity) ? result.imageDensity : fallback.imageDensity,
      totalSlides: Math.min(20, Math.max(2, parseInt(result.totalSlides, 10) || fallback.totalSlides)),
      continuation: ['more-examples', 'different-examples', 'related-topics'].includes(result.continuation) ? result.continuation : fallback.continuation,
      alternateVisualMath: result.alternateVisualMath !== false
    };

    res.json(out);
  } catch {
    res.json(fallback);
  }
});

// ---------- AI: refresh concepts for one level only ----------
app.post('/api/ai/path/level-refresh', auth, async (req, res) => {
  const { topic, level, count = 5, avoidConcepts = [], guidance } = req.body || {};
  if (!topic || !level) return res.status(400).json({ error: 'Topic and level are required' });
  const wanted = Math.min(8, Math.max(3, parseInt(count, 10) || 5));
  const games = await recentUserGames(req.user.username, 20);
  const recent = games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): ${g.correct}/${g.total}`).join('\n');
  const avoid = (Array.isArray(avoidConcepts) ? avoidConcepts : []).map(String).filter(Boolean).slice(0, 40);

  if (!geminiEnabled && !deepseekEnabled) {
    return res.json(makeFallbackLevelConcepts(topic, level, wanted, avoid));
  }

  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a curriculum designer. Return JSON only:
{"level":string,"description":string,"concepts":[{"name":string,"blurb":string}]}
Rules:
- level must be exactly "${level}".
- exactly ${wanted} concepts.
- Keep concepts strictly at ${level} difficulty.
- concepts must be different from the avoid list.
- blurb max 15 words each.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n${guidance ? `Guidance: ${guidance}\n` : ''}Avoid concepts:\n${avoid.join('\n') || 'none'}\n\nRecent learner history:\n${recent || 'none yet'}\n\nBalance: reinforce this learner's weak spots while still surfacing globally relevant, timely angles.`
      }
    ], { temperature: 0.8, maxTokens: 2200 });

    const out = {
      level,
      description: String(result.description || '').trim(),
      concepts: (result.concepts || [])
        .map(c => ({ name: String(c.name || '').trim(), blurb: String(c.blurb || '').trim() }))
        .filter(c => c.name)
        .filter((c, i, arr) => arr.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase()) === i)
        .slice(0, wanted)
    };
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: one slide (also used to prefetch each answer branch) ----------
app.post('/api/ai/slide', auth, async (req, res) => {
  const { gameId, topic, concept, level, settings = {}, slideNumber, totalSlides, history = [], branch } = req.body || {};
  if (!topic || !concept || !slideNumber || !totalSlides) return res.status(400).json({ error: 'Missing slide context' });

  const paragraphWords = { brief: '40-60', medium: '70-100', detailed: '110-150' }[settings.paragraphLength] || '70-100';
  const paraCount = Math.min(7, Math.max(1, parseInt(settings.paragraphCount, 10) || 3));
  const densityRule = {
    'text-only': 'Use NO visual components (no svg/latex/code/image) — prose only.',
    'mostly-text': 'Mostly text: the paragraphs plus at most ONE visual component.',
    'balanced': 'Include the paragraphs plus ONE well-chosen visual that carries as much meaning as the words.',
    'mostly-visual': `Lead with 1-2 visual components that dominate the slide, but STILL include at least TWO connected paragraphs (each ${paragraphWords} words) explaining them.`
  }[settings.imageDensity] || 'Include one visual component alongside the paragraphs.';
  const allowModelSvg = !imageEnabled && !claudeSvgEnabled;
  const isTimeTravelActivity = settings.activityType === 'time-travel' || /time\s*travel|\bfuture\b|\bpast\b|\bpresent\b|headline|news/i.test(`${topic} ${concept} ${settings.customInstructions || ''}`);
  const canGenerateImage = true;
  const stemFocus = /math|physics|program|algorithm|computer|data|statistics|calculus|algebra|geometry|numerical|machine learning|ai|engineering|cryptography|proof|equation|formula|theorem|derivative|integral|linear algebra|probability/i
    .test(`${topic} ${concept}`);
  const equationDepth = {
    brief: 'Use 1 compact but meaningful derivation/proof block with 2-4 lines.',
    medium: 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.',
    detailed: 'Use a longer derivation/proof with 7-12 lines, explicitly showing key intermediate steps and assumptions.'
  }[settings.paragraphLength] || 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.';
  const codeDepth = {
    brief: 'Use a focused snippet around 8-15 lines.',
    medium: 'Use a practical snippet around 16-28 lines.',
    detailed: 'Use a richer snippet around 28-45 lines, still coherent and runnable.'
  }[settings.paragraphLength] || 'Use a practical snippet around 16-28 lines.';
  const stemAlternation = slideNumber % 2 === 1
    ? 'STEM alternation for this slide: emphasize theory + formulas/proof first, then support with a visual aid.'
    : 'STEM alternation for this slide: emphasize visual intuition first, then include code or formulas/proof with detailed explanation.';

  const system = `You are an expert teacher generating ONE slide of an adaptive learning presentation. Respond ONLY with JSON in this schema:
{
 "title": string (max 8 words),
 "summary": string (one sentence describing what this slide taught, for memory),
 "components": [
   {"type":"text","content":string (may contain inline LaTeX between single $ signs, e.g. $E=mc^2$)} |
   {"type":"keypoints","items":[string,...]} |
   {"type":"definition","term":string,"content":string} |
   {"type":"example","content":string} |
   {"type":"table","headers":[string,...],"rows":[[string,...],...],"caption":string} |
   {"type":"latex","content":string (a DISPLAY formula in LaTeX, WITHOUT surrounding $),"caption":string} |
   {"type":"code","language":string,"content":string (a real, correct, well-formatted snippet with newlines)} |
  {"type":"svg","svg":"<svg...>","caption":string} |
  {"type":"table","headers":[string,...],"rows":[[string,...],...],"caption":string}
 ],
 "quiz": {
   "question": string,
   "options": [
     {"text": string, "correct": boolean, "explanation": string (1-2 sentences shown when this option is picked), "misconception": string (for wrong options: what misunderstanding this choice reveals; empty for the correct one)}
   ]
 }
}
Rules:
- Exactly 4 quiz options, exactly ONE with "correct": true, shuffled position.
- Make the quiz genuinely CHALLENGING, not obvious: every option must be on-topic and plausible to someone who only half-understood the slide. Never make the correct answer the conspicuously longest or most detailed, and never make wrong options absurd or off-topic. Each wrong option is a common, tempting mistake that reveals a DIFFERENT misconception. A careless reader should be able to fall for a distractor; only careful reasoning from the slide's paragraphs should yield the right answer.
- LENGTH: the slide MUST contain exactly ${paraCount} distinct paragraph(s) of prose (as separate "text" components), each about ${paragraphWords} words. Do not collapse them, and do not pad — each paragraph carries new substance. ${densityRule}
- COHESION: the paragraphs must build on one another in order — introduce the idea, develop it, then apply or consolidate it — never restating the same point. The slide must also connect to the previous slides (briefly recall or build on them) and set up what comes next, so the whole presentation reads as one continuous, complementary lesson rather than isolated cards.
- TABLES: when using a table, keep it compact (3-6 rows, 2-6 columns), label headers clearly, and ensure every row directly supports the slide's teaching point.
- QUIZ ALIGNMENT: if a table is included, it must directly help answer this slide's multiple-choice question or explain one likely misconception.
- If a code snippet is included: ${codeDepth} Include clear inline comments that explain non-obvious lines and decisions.
- If a LaTeX formula/proof block is included: ${equationDepth} Follow it with explanatory text that walks through the symbols and logic step-by-step.
- Any formula/proof/code explanation should be as substantial as the selected paragraph length setting; avoid tiny token examples for long-form settings.
- ${stemFocus ? `${stemAlternation} For this STEM-heavy concept, include either a code snippet or a LaTeX formula/proof block, plus textual explanation tying them together.` : 'Use STEM-style formula/code components only when they naturally fit the concept.'}
- ${isTimeTravelActivity
  ? 'This is a Time Travel activity slide: keep the explanation timeline-aware and use a table only if it genuinely clarifies the progression.'
  : "For non-time-travel activities, keep the explanation tied to the concept and the learner's previous answer."}
- For this deployment, NEVER emit image or svg components.
- Tone/sentiment of all writing: ${settings.tone || 'friendly lecture'}. Complexity of language: ${settings.complexity || 'standard'}. Audience level: ${level}.
${settings.language ? `- Write ALL text (including quiz and explanations) in ${settings.language}.\n` : ''}${settings.audience ? `- The reader is: ${settings.audience}. Pitch every explanation to them.\n` : ''}${settings.customInstructions ? `- Extra author instructions from the learner (follow them where they don't conflict with the schema): ${settings.customInstructions}\n` : ''}
- The ${paraCount} substantive paragraph(s) are required every time, alongside any optional table.
- Make the next slide depend on the previous answer: if the learner was wrong, explicitly explain the misconception and steer them back toward the right reasoning; if the learner was right, reinforce the idea from a different angle and continue forward.`;

  const historyText = history.length
    ? 'Slides so far:\n' + history.map((h, i) =>
        `${i + 1}. "${h.title}" — ${h.summary} (quiz: "${h.question}" → learner chose "${h.chosen}", ${h.correct ? 'CORRECT' : 'WRONG'}). Visuals used: ${Array.isArray(h.visualRefs) && h.visualRefs.length ? h.visualRefs.join(' || ') : 'none'}`).join('\n')
    : 'This is the first slide.';

  let branchText = '';
  if (branch) {
    branchText = branch.correct
      ? `\nThe learner just answered the previous quiz CORRECTLY ("${branch.chosenText}"). This slide must go DEEPER into the concept: build on that success and drill further.`
      : `\nThe learner just answered the previous quiz WRONG ("${branch.chosenText}"), revealing this misconception: "${branch.misconception}". This slide must REDIRECT them: address that specific misconception head-on, re-explain the underlying idea from a different angle, then move forward.`;
  }

  if (!geminiEnabled && !deepseekEnabled) {
    const slide = makeFallbackSlide({ topic, concept, level, settings, slideNumber, totalSlides, branch });
    slide.components = sanitizeComponents(slide.components);
    slide.components = (slide.components || []).filter(c => c?.type !== 'image' && c?.type !== 'svg');
    if (settings.imageDensity === 'text-only') {
      slide.components = (slide.components || []).filter(c => !['svg', 'image', 'latex', 'code', 'table'].includes(c.type));
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    const genId = `${gameId || 'nogame'}-slide${slideNumber}-fallback`;
    saveGeneration('slides', genId, {
      username: req.user.username,
      topic,
      concept,
      level,
      settings,
      slideNumber,
      branch: branch || null,
      fallback: true,
      slide,
      createdAt: new Date().toISOString()
    });
    return res.json(slide);
  }

  const user = `Topic: ${topic}\nConcept being taught: ${concept}\nAudience level: ${level}\nThis is slide ${slideNumber} of ${totalSlides}.${slideNumber >= totalSlides ? ' This is the FINAL content slide: wrap up the concept and make the quiz a synthesis question.' : ''}\n${historyText}${branchText}`;

  try {
    const slide = await generateStructured([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 8192 });
    slide.components = sanitizeComponents(slide.components);
    slide.components = (slide.components || []).filter(c => c?.type !== 'image' && c?.type !== 'svg');
    if (settings.imageDensity === 'text-only') {
      slide.components = slide.components.filter(c => !['latex', 'code', 'table'].includes(c.type));
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    if (!slide.quiz || !Array.isArray(slide.quiz.options) || !slide.quiz.options.some(o => o.correct)) {
      throw new Error('Model returned a slide without a valid quiz, please retry');
    }
    const genId = `${gameId || 'nogame'}-slide${slideNumber}${branch ? '-' + (branch.correct ? 'deeper' : 'remedial') + '-' + crypto.randomBytes(3).toString('hex') : ''}`;
    saveGeneration('slides', genId, { username: req.user.username, topic, concept, level, settings, slideNumber, branch: branch || null, slide, createdAt: new Date().toISOString() });
    res.json(slide);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: end-of-game recommendations ----------
app.post('/api/ai/recommend', auth, async (req, res) => {
  const { topic, concept, level, correct, total, durationSec, slides = [] } = req.body || {};
  const history = await recentUserGames(req.user.username, 12);
  if (!geminiEnabled && !deepseekEnabled) {
    const fallback = makeFallbackRecommendation({ topic, concept, level, correct, total, slides });
    saveGeneration('recommendations', crypto.randomUUID(), { username: req.user.username, topic, concept, result: fallback, fallback: true, createdAt: new Date().toISOString() });
    return res.json(fallback);
  }
  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a learning coach. Given a learner's quiz performance, respond ONLY with JSON:
{"summary": string (2 sentences, warm, specific), "questionSummary": [string, string, string], "answerSummary": [string, string, string], "aiNotes": [string, string, string], "recommendations": [string, string, string], "nextConcepts": [{"name": string, "level": string}]}
Recommendations must reference the actual mistakes made. questionSummary should list the main question themes in this lesson. answerSummary should list the learner's answer patterns or choices. aiNotes should compare this lesson against the recent history below and explain the learner's progress in the same field, with specific next steps. nextConcepts: 2-3 concepts to study next.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}, concept: ${concept}, level: ${level}. Score ${correct}/${total} in ${durationSec}s.\n\nRecent lessons in the same field:\n${history.filter(g => g.topic === topic).map(g => `- ${g.finishedDate || g.finishedAt}: ${g.concept} (${g.level}) ${g.correct}/${g.total}`).join('\n') || 'none yet'}\n\nAnswers:\n` +
          slides.map((s, i) => `${i + 1}. "${s.question}" → chose "${s.chosen}" (${s.correct ? 'correct' : `wrong — misconception: ${s.misconception || 'unknown'}`})`).join('\n')
      }
    ], { temperature: 0.7, maxTokens: 4096 });
    const questionSummary = slides.map(s => String(s.question || '').trim()).filter(Boolean);
    const answerSummary = slides.map(s => String(s.chosen || '').trim()).filter(Boolean);
    const normalized = {
      summary: String(result.summary || '').trim(),
      questionSummary,
      answerSummary,
      aiNotes: Array.isArray(result.aiNotes) ? result.aiNotes.map(v => String(v).trim()).filter(Boolean) : [],
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.map(v => String(v).trim()).filter(Boolean) : [],
      nextConcepts: Array.isArray(result.nextConcepts) ? result.nextConcepts : []
    };
    saveGeneration('recommendations', crypto.randomUUID(), { username: req.user.username, topic, concept, result: normalized, createdAt: new Date().toISOString() });
    res.json(normalized);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: coach chat (sees the user's progress data) ----------
app.post('/api/ai/chat', auth, async (req, res) => {
  const { messages = [] } = req.body || {};
  const games = readJSON('games.json', []).filter(g => g.username === req.user.username);
  const progress = games.slice(-20).map(g => ({
    date: g.finishedAt, topic: g.topic, concept: g.concept, level: g.level,
    score: `${g.correct}/${g.total}`, durationSec: g.durationSec
  }));
  if (!geminiEnabled && !deepseekEnabled) {
    return res.json({ reply: makeFallbackCoachReply(progress) });
  }
  try {
    const reply = await generateText([
      {
        role: 'system',
        content: `You are the SketchLearn coach: a friendly guide inside an adaptive learning website. The site works like this: the learner picks a topic (or types a custom one), the AI builds a learning path across Beginner → Lower Intermediate → Upper Intermediate → Advanced → PhD levels, the learner picks a concept and tunes settings (number of slides, tone, text complexity, paragraph length, and how visual the slides are), then plays through AI-generated slides each ending in a comprehension quiz; wrong answers branch into remediation slides, right answers drill deeper; the final slide shows their stats.
Here is this learner's progress spreadsheet (their recent completed activities), as JSON:
${JSON.stringify(progress, null, 1)}
Use it to give concrete, personal guidance: point out strong/weak topics, suggest which concept and level to try next, and explain which settings to use. Keep replies short and warm (under 150 words unless asked for more). The learner is "${req.user.username}".`
      },
      ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
    ], { json: false, temperature: 0.8, maxTokens: 800 });
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function bootstrapPersistence() {
  if (!pgPool) {
    if (!Array.isArray(users) || !users.length) {
      users = [makeUser('admin', '123456', 'admin')];
      writeJSON('users.json', users);
      console.log('Seeded default admin user (admin / 123456)');
    }
    return;
  }

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
  users = dbUsers;

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
}

async function startServer() {
  await bootstrapPersistence();
  app.listen(PORT, () => {
    console.log(`SketchLearn running on http://localhost:${PORT}`);
    console.log(`Persistence: ${pgPool ? 'Postgres' : 'JSON files'}`);
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
