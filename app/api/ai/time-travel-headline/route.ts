import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { GLOBAL_TREND_SEEDS } from '@/src/config';
import { recentUserGames } from '@/src/db/games';
import { generateStructured } from '@/src/ai/providers';
import { buildTimeTravelHeadlinePrompt } from '@/src/ai/prompts/time-travel-headline';
import { summarizeLearnerStatus } from '@/src/slides/visual-policy';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { period = 'future', avoidHeadlines = [] } = (await req.json().catch(() => ({}))) || {};
  const normalizedPeriod = ['past', 'present', 'future'].includes(String(period).toLowerCase())
    ? String(period).toLowerCase()
    : 'future';
  const avoidSet = new Set((Array.isArray(avoidHeadlines) ? avoidHeadlines : []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));

  const fallbackPool: Record<string, string[]> = {
    past: [
      'Printing Press Sparks Knowledge Boom Across Europe',
      'Ancient Engineers Race to Rebuild Earthquake-Struck Harbor',
      'Young Astronomers Redraw the Night Sky with New Instruments',
      'City-State Debates First Public Health Rules After Outbreak',
    ],
    present: [
      'Local Grid Uses AI Forecasts to Prevent Blackouts During Heat Wave',
      'Students Track Urban Flood Risks with Open Satellite Data',
      'Community Lab Designs Low-Cost Air Quality Alerts',
      'Hospitals Test New Data Dashboards to Speed Emergency Care',
    ],
    future: [
      'Mars Transit Council Approves First Interplanetary Water Treaty',
      'Floating Cities Deploy Storm-Deflection Fields Ahead of Mega Cyclone',
      'Lunar Farms Rewrite Food Supply Chains for Deep-Space Colonies',
      'Quantum Weather Net Warns Coastal Regions 30 Days Earlier',
    ],
  };

  try {
    const games = await recentUserGames(a.user.username, 20);
    const interests = [...new Set(games.map((g: any) => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-10);
    const status = summarizeLearnerStatus(games);
    const tth = buildTimeTravelHeadlinePrompt({ normalizedPeriod, interests, status, trendSeeds: GLOBAL_TREND_SEEDS, avoidSet });
    const result = await generateStructured([
      { role: 'system', content: tth.system },
      { role: 'user', content: tth.user },
    ], { temperature: 0.85, maxTokens: 240 });

    const raw = String(result.headline || '').trim();
    if (raw && !avoidSet.has(raw.toLowerCase())) return NextResponse.json({ headline: raw });
    throw new Error('Invalid headline');
  } catch {
    const pool = fallbackPool[normalizedPeriod] || fallbackPool.future;
    const candidate = pool.find(h => !avoidSet.has(h.toLowerCase())) || pool[0];
    return NextResponse.json({ headline: candidate });
  }
}
