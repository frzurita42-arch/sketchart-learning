import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { recentUserGames } from '@/src/db/games';
import { generateStructured } from '@/src/ai/providers';
import { buildStructuredSuggestPrompt } from '@/src/ai/prompts/structured-suggest';
import { summarizeLearnerStatus, buildStructuredSuggestFallback } from '@/src/slides/visual-policy';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { avoidPrompts = [] } = (await req.json().catch(() => ({}))) || {};
  const avoidSet = new Set((Array.isArray(avoidPrompts) ? avoidPrompts : []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));

  let games: any[] = [];
  try { games = await recentUserGames(a.user.username, 20); } catch { games = []; }
  // Varied, history-grounded default used both to fill any gaps in the AI reply and
  // when no AI provider is reachable (so repeated clicks never return one fixed topic).
  const fallback = buildStructuredSuggestFallback(games, avoidSet);

  try {
    const interests = [...new Set(games.map((g: any) => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-12);
    const status = summarizeLearnerStatus(games);
    const ssp = buildStructuredSuggestPrompt({ interests, status, avoidSet });
    const result = await generateStructured([
      { role: 'system', content: ssp.system },
      { role: 'user', content: ssp.user },
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
      alternateVisualMath: result.alternateVisualMath !== false,
    };

    return NextResponse.json(out);
  } catch {
    // Fresh varied pick each call so the button rotates instead of repeating one topic.
    return NextResponse.json(buildStructuredSuggestFallback(games, avoidSet));
  }
}
