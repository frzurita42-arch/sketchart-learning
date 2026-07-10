import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { queueSuggestedPairRefresh } from '@/lib/ai-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { avoidTopics = [], triggerTopic = '' } = (await req.json().catch(() => ({}))) || {};
  queueSuggestedPairRefresh(a.user.username, { avoidTopics, triggerTopic });
  return NextResponse.json({ ok: true });
}
