import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { DEFAULT_SUGGESTION_PAIR } from '@/src/config';
import {
  isValidSuggestion, readSuggestedStore, writeSuggestedStore,
  randomPickSuggestionNoRepeat, makeFallbackPair,
} from '@/src/db/caches';
import { requireAuth } from '@/lib/auth-guard';
import { refreshSuggestedPairForUser, queueSuggestedPairRefresh } from '@/lib/ai-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { avoidTopics = [], refresh = false, triggerTopic = '' } = (await req.json().catch(() => ({}))) || {};
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readSuggestedStore();
  const username = a.user.username;

  if (refresh) {
    try {
      const pair = await refreshSuggestedPairForUser(username, { avoidTopics, triggerTopic }, store);
      const entry = store.users[username] || { pair, lastShownTopic: null };
      const picked = randomPickSuggestionNoRepeat(entry.pair || pair, avoidSet, entry.lastShownTopic) || pair[0] || DEFAULT_SUGGESTION_PAIR[0];
      entry.lastShownTopic = picked.topic;
      store.users[username] = entry;
      await writeSuggestedStore(store);
      return NextResponse.json({ ...picked, cached: false, pairUpdated: true });
    } catch {
      const fallback = makeFallbackPair(avoidSet, triggerTopic)[0];
      return NextResponse.json({ ...fallback, cached: true, pairUpdated: false });
    }
  }

  const userPair = Array.isArray(store.users?.[username]?.pair)
    ? store.users[username].pair.filter(isValidSuggestion)
    : [];
  const defaults = (Array.isArray(store.defaults) && store.defaults.length)
    ? store.defaults.filter(isValidSuggestion)
    : DEFAULT_SUGGESTION_PAIR;

  const activePair = userPair.length ? userPair : defaults;
  if (!userPair.length) {
    store.users[username] = {
      pair: activePair.slice(0, 2),
      cursor: 0,
      lastShownTopic: null,
      updatedAt: new Date().toISOString(),
      triggerTopic: null,
    };
    await writeSuggestedStore(store);
    queueSuggestedPairRefresh(username, { avoidTopics, triggerTopic });
  }

  const entry = store.users[username] || { pair: activePair, lastShownTopic: null };
  const picked = randomPickSuggestionNoRepeat(entry.pair || activePair, avoidSet, entry.lastShownTopic) || activePair[0] || DEFAULT_SUGGESTION_PAIR[0];
  entry.lastShownTopic = picked.topic;
  store.users[username] = entry;
  await writeSuggestedStore(store);
  return NextResponse.json({ ...picked, cached: true, pairUpdated: false });
}
