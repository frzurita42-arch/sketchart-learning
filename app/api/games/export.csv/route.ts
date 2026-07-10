import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { readGames } from '@/src/db/games';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const games = await readGames();
  const mine = a.user.role === 'admin' ? games : games.filter((g: any) => g.username === a.user.username);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows: any[][] = [['user', 'date', 'time', 'topic', 'concept', 'level', 'correct', 'total', 'score_pct', 'duration_sec', 'question_summary', 'answer_summary', 'ai_notes', 'share_url']];
  for (const g of mine) {
    rows.push([
      g.username,
      g.finishedDate || g.finishedAt,
      g.finishedTime || '',
      g.topic,
      g.concept,
      g.level,
      g.correct,
      g.total,
      g.total ? Math.round(100 * g.correct / g.total) : 0,
      g.durationSec,
      Array.isArray(g.questionSummary) ? g.questionSummary.join(' | ') : (g.questionSummary || ''),
      Array.isArray(g.answerSummary) ? g.answerSummary.join(' | ') : (g.answerSummary || ''),
      Array.isArray(g.aiNotes) ? g.aiNotes.join(' | ') : (g.aiNotes || ''),
      g.shareUrl || '',
    ]);
  }
  const csv = rows.map(r => r.map(esc).join(',')).join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="sketchlearn-progress.csv"',
    },
  });
}
