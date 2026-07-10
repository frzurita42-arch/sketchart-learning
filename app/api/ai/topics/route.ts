import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { DEFAULT_HOME_TOPIC_POOL } from '@/src/config';
import {
  readHomeTopicsStore, writeHomeTopicsStore, normalizeTopicPool, rotatePickFromList,
} from '@/src/db/caches';
import { requireAuth } from '@/lib/auth-guard';
import { refreshHomeTopicPoolForUser, queueHomeTopicPoolRefresh } from '@/lib/ai-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { count = 12, avoid = [], refresh = false, triggerTopic = '' } = (await req.json().catch(() => ({}))) || {};
  const wanted = Math.min(20, Math.max(6, parseInt(count, 10) || 12));
  const avoidSet = new Set((Array.isArray(avoid) ? avoid : []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readHomeTopicsStore();
  const username = a.user.username;

  if (refresh) {
    try {
      const pool = await refreshHomeTopicPoolForUser(username, { avoid, triggerTopic, poolSize: 24 }, store);
      const entry = store.users[username] || { topics: pool, cursor: 0 };
      const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
      entry.cursor = rotated.nextCursor;
      store.users[username] = entry;
      await writeHomeTopicsStore(store);
      return NextResponse.json({ topics: rotated.items.map((name: string) => ({ name, why: '' })), cached: false, poolUpdated: true });
    } catch {
      const rotated = rotatePickFromList(store.defaults || DEFAULT_HOME_TOPIC_POOL, wanted, avoidSet, 0);
      return NextResponse.json({ topics: rotated.items.map((name: string) => ({ name, why: '' })), cached: true, poolUpdated: false });
    }
  }

  const userEntry = store.users[username] || null;
  const pool = normalizeTopicPool(userEntry?.topics, normalizeTopicPool(store.defaults, DEFAULT_HOME_TOPIC_POOL));
  const hasUserPool = !!(userEntry && Array.isArray(userEntry.topics) && userEntry.topics.length);

  if (!hasUserPool) {
    store.users[username] = {
      topics: pool,
      cursor: 0,
      updatedAt: new Date().toISOString(),
      triggerTopic: null,
    };
    await writeHomeTopicsStore(store);
    queueHomeTopicPoolRefresh(username, { avoid, triggerTopic, poolSize: 24 });
  }

  const entry = store.users[username] || { topics: pool, cursor: 0 };
  const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
  entry.cursor = rotated.nextCursor;
  store.users[username] = entry;
  await writeHomeTopicsStore(store);
  return NextResponse.json({ topics: rotated.items.map((name: string) => ({ name, why: '' })), cached: true, poolUpdated: false });
}
