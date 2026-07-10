import '@/lib/legacy-env';
import crypto from 'crypto';
import { GLOBAL_TREND_SEEDS, DEFAULT_HOME_TOPIC_POOL } from '@/src/config';
import { saveGeneration } from '@/src/db/persistence';
import { recentUserGames } from '@/src/db/games';
import {
  readSuggestedStore, writeSuggestedStore, readHomeTopicsStore, writeHomeTopicsStore,
  normalizeTopicPool, makeFallbackPair, normalizeSuggestion,
} from '@/src/db/caches';
import { generateStructured } from '@/src/ai/providers';
import { buildHomeTopicPoolPrompt } from '@/src/ai/prompts/home-topics';
import { buildSuggestedTopicPrompt } from '@/src/ai/prompts/suggested-topic';

/* Shared AI background helpers, ported verbatim from src/routes/ai.routes.js.
 * Used by both the /api/ai/topics(+preload) and /api/ai/suggested-topic(+preload)
 * route handlers, so they live here in one place. */

// ---------- home topic pool ----------
export async function generateHomeTopicPoolForUser(username: string, { avoid = [], triggerTopic = '', poolSize = 24 }: any = {}) {
  const games = await recentUserGames(username, 30);
  const learned = [...new Set(games.map((g: any) => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-20);
  const avoidList = Array.isArray(avoid) ? avoid.map(String).filter(Boolean).slice(0, 50) : [];
  const wantedPool = Math.min(36, Math.max(18, parseInt(poolSize, 10) || 24));

  const htp = buildHomeTopicPoolPrompt({ wantedPool, triggerTopic, learned, trendSeeds: GLOBAL_TREND_SEEDS, avoidList });
  const result = await generateStructured([
    { role: 'system', content: htp.system },
    { role: 'user', content: htp.user },
  ], { temperature: 0.74, maxTokens: 2200 });

  return normalizeTopicPool((result.topics || []).map((t: any) => t.name), DEFAULT_HOME_TOPIC_POOL);
}

export async function refreshHomeTopicPoolForUser(username: string, options: any = {}, store: any = null) {
  const activeStore = store || await readHomeTopicsStore();
  const pool = await generateHomeTopicPoolForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    topics: pool,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null,
  };
  await writeHomeTopicsStore(activeStore);
  saveGeneration('home-topics', crypto.randomUUID(), { username, options, topics: pool, createdAt: new Date().toISOString() });
  return pool;
}

export function queueHomeTopicPoolRefresh(username: string, options: any = {}) {
  setTimeout(() => {
    refreshHomeTopicPoolForUser(username, options).catch((e: any) => {
      console.error('Background home-topic refresh failed:', e.message);
    });
  }, 0);
}

// ---------- suggested pair ----------
export async function generateSuggestedPairForUser(username: string, { avoidTopics = [], triggerTopic = '' }: any = {}) {
  const games = await recentUserGames(username, 25);
  const recent = games.slice(-12);
  const sameField = [...new Set(recent.map((g: any) => String(g.topic || '').trim()).filter(Boolean))].slice(-8);
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));
  const fallbackPair = makeFallbackPair(avoidSet, triggerTopic || sameField[sameField.length - 1] || '');

  const stp = buildSuggestedTopicPrompt({ triggerTopic, recent, sameField, trendSeeds: GLOBAL_TREND_SEEDS, avoidSet });
  const ai = await generateStructured([
    { role: 'system', content: stp.system },
    { role: 'user', content: stp.user },
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

export async function refreshSuggestedPairForUser(username: string, options: any = {}, store: any = null) {
  const activeStore = store || await readSuggestedStore();
  const pair = await generateSuggestedPairForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    pair,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    lastShownTopic: String(previous.lastShownTopic || '').trim() || null,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null,
  };
  await writeSuggestedStore(activeStore);
  saveGeneration('suggestions', crypto.randomUUID(), { username, options, pair, createdAt: new Date().toISOString() });
  return pair;
}

export function queueSuggestedPairRefresh(username: string, options: any = {}) {
  setTimeout(() => {
    refreshSuggestedPairForUser(username, options).catch((e: any) => {
      console.error('Background suggested-topic refresh failed:', e.message);
    });
  }, 0);
}
