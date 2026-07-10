import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { geminiEnabled, deepseekEnabled } from '@/src/config';
import { readJSON, saveGeneration } from '@/src/db/persistence';
import { generateStructured } from '@/src/ai/providers';
import { buildLearningPathPrompt } from '@/src/ai/prompts/learning-path';
import { makeFallbackLearningPath } from '@/src/slides/fallback';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { topic, guidance, levels, fromHistory, freshSeed } = (await req.json().catch(() => ({}))) || {};
  if (!topic) return NextResponse.json({ error: 'Topic required' }, { status: 400 });
  const allLevels = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
  const wanted = Array.isArray(levels) && levels.length ? allLevels.filter(l => levels.includes(l)) : allLevels;

  // When refreshing from history, feed the learner's recent activity so the path adapts.
  let historyLine = '';
  if (fromHistory) {
    const games = readJSON('games.json', []).filter((g: any) => g.username === a.user.username).slice(-15);
    if (games.length) {
      historyLine = '\nThe learner has recently studied (adapt the path to build on strengths and shore up weak spots, and suggest fresh concepts they have NOT yet seen):\n' +
        games.map((g: any) => `- ${g.topic} / ${g.concept} (${g.level}): scored ${g.correct}/${g.total}`).join('\n');
    } else {
      historyLine = '\nThe learner has no history yet — give a well-rounded introductory path.';
    }
  }

  try {
    if (!geminiEnabled && !deepseekEnabled) {
      const fallback = makeFallbackLearningPath(topic, wanted);
      return NextResponse.json({ ...fallback, fallback: true });
    }
    const lp = buildLearningPathPrompt({ wanted, topic, guidance, historyLine, freshSeed });
    const result = await generateStructured([
      { role: 'system', content: lp.system },
      { role: 'user', content: lp.user },
    ], { temperature: fromHistory || freshSeed ? 0.95 : 0.7, maxTokens: 4096 });
    const id = crypto.randomUUID();
    saveGeneration('paths', id, { username: a.user.username, topic, guidance, result, createdAt: new Date().toISOString() });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
