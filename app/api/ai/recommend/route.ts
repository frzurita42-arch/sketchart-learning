import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { geminiEnabled, deepseekEnabled } from '@/src/config';
import { saveGeneration } from '@/src/db/persistence';
import { recentUserGames } from '@/src/db/games';
import { generateStructured } from '@/src/ai/providers';
import { buildRecommendPrompt } from '@/src/ai/prompts/coach';
import { makeFallbackRecommendation } from '@/src/slides/fallback';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { topic, concept, level, correct, total, durationSec, slides = [] } = (await req.json().catch(() => ({}))) || {};
  const history = await recentUserGames(a.user.username, 12);
  if (!geminiEnabled && !deepseekEnabled) {
    const fallback = makeFallbackRecommendation({ topic, concept, level, correct, total, slides });
    saveGeneration('recommendations', crypto.randomUUID(), { username: a.user.username, topic, concept, result: fallback, fallback: true, createdAt: new Date().toISOString() });
    return NextResponse.json(fallback);
  }
  try {
    const rec = buildRecommendPrompt({ topic, concept, level, correct, total, durationSec, history, slides });
    const result = await generateStructured([
      { role: 'system', content: rec.system },
      { role: 'user', content: rec.user },
    ], { temperature: 0.7, maxTokens: 4096 });
    const questionSummary = slides.map((s: any) => String(s.question || '').trim()).filter(Boolean);
    const answerSummary = slides.map((s: any) => String(s.chosen || '').trim()).filter(Boolean);
    const normalized = {
      summary: String(result.summary || '').trim(),
      questionSummary,
      answerSummary,
      aiNotes: Array.isArray(result.aiNotes) ? result.aiNotes.map((v: any) => String(v).trim()).filter(Boolean) : [],
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.map((v: any) => String(v).trim()).filter(Boolean) : [],
      nextConcepts: Array.isArray(result.nextConcepts) ? result.nextConcepts : [],
    };
    saveGeneration('recommendations', crypto.randomUUID(), { username: a.user.username, topic, concept, result: normalized, createdAt: new Date().toISOString() });
    return NextResponse.json(normalized);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
