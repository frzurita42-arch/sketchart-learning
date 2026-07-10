import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { geminiEnabled, deepseekEnabled } from '@/src/config';
import { readJSON } from '@/src/db/persistence';
import { generateText } from '@/src/ai/providers';
import { buildCoachChatSystem } from '@/src/ai/prompts/coach';
import { makeFallbackCoachReply } from '@/src/slides/fallback';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { messages = [] } = (await req.json().catch(() => ({}))) || {};
  const games = readJSON('games.json', []).filter((g: any) => g.username === a.user.username);
  const progress = games.slice(-20).map((g: any) => ({
    date: g.finishedAt, topic: g.topic, concept: g.concept, level: g.level,
    score: `${g.correct}/${g.total}`, durationSec: g.durationSec,
  }));
  if (!geminiEnabled && !deepseekEnabled) {
    return NextResponse.json({ reply: makeFallbackCoachReply(progress) });
  }
  try {
    const reply = await generateText([
      { role: 'system', content: buildCoachChatSystem({ progress, username: a.user.username }) },
      ...messages.slice(-16).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) })),
    ], { json: false, temperature: 0.8, maxTokens: 800 });
    return NextResponse.json({ reply });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
