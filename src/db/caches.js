/* Per-user caches for the home-page topic chips and the suggested-topic pair,
 * plus the rotate/pick/normalize helpers that keep those suggestions varied. */
const { db, dbQuery } = require('./pool');
const { readJSON, writeJSON } = require('./persistence');
const {
  SUGGESTED_STORE_FILE, HOME_TOPICS_STORE_FILE,
  DEFAULT_SUGGESTION_PAIR, DEFAULT_HOME_TOPIC_POOL, GLOBAL_TREND_SEEDS
} = require('../config');

function normalizeStoreShape(store, defaults) {
  const next = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(next.defaults) || !next.defaults.length) next.defaults = defaults;
  if (!next.users || typeof next.users !== 'object') next.users = {};
  return next;
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
  if (db.pool) {
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
  if (!db.pool) {
    writeJSON(SUGGESTED_STORE_FILE, normalized);
    return;
  }
  const client = await db.pool.connect();
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
  if (db.pool) {
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
  if (!db.pool) {
    writeJSON(HOME_TOPICS_STORE_FILE, normalized);
    return;
  }
  const client = await db.pool.connect();
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

module.exports = {
  normalizeStoreShape,
  pickRandom,
  isValidSuggestion,
  readSuggestedStore,
  writeSuggestedStore,
  readHomeTopicsStore,
  writeHomeTopicsStore,
  normalizeTopicPool,
  rotatePickFromList,
  rotatePickSuggestionFromPair,
  randomPickSuggestionNoRepeat,
  makeFallbackPair,
  normalizeSuggestion,
  pickSuggestionFromPair
};
