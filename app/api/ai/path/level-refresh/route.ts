import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { geminiEnabled, deepseekEnabled } from '@/src/config';
import { recentUserGames } from '@/src/db/games';
import { generateStructured } from '@/src/ai/providers';
import { buildLevelRefreshPrompt } from '@/src/ai/prompts/level-refresh';
import { makeFallbackLevelConcepts } from '@/src/slides/fallback';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { topic, level, count = 5, avoidConcepts = [], guidance } = (await req.json().catch(() => ({}))) || {};
  if (!topic || !level) return NextResponse.json({ error: 'Topic and level are required' }, { status: 400 });
  const wanted = Math.min(8, Math.max(3, parseInt(count, 10) || 5));
  const games = await recentUserGames(a.user.username, 20);
  const recent = games.map((g: any) => `- ${g.topic} / ${g.concept} (${g.level}): ${g.correct}/${g.total}`).join('\n');
  const avoid = (Array.isArray(avoidConcepts) ? avoidConcepts : []).map(String).filter(Boolean).slice(0, 40);

  if (!geminiEnabled && !deepseekEnabled) {
    return NextResponse.json(makeFallbackLevelConcepts(topic, level, wanted, avoid));
  }

  try {
    const lr = buildLevelRefreshPrompt({ level, wanted, topic, guidance, avoid, recent });
    const result = await generateStructured([
      { role: 'system', content: lr.system },
      { role: 'user', content: lr.user },
    ], { temperature: 0.8, maxTokens: 2200 });

    const out = {
      level,
      description: String(result.description || '').trim(),
      concepts: (result.concepts || [])
        .map((c: any) => ({ name: String(c.name || '').trim(), blurb: String(c.blurb || '').trim() }))
        .filter((c: any) => c.name)
        .filter((c: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.name.toLowerCase() === c.name.toLowerCase()) === i)
        .slice(0, wanted),
    };
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
