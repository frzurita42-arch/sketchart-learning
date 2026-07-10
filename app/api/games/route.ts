import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { readGames, insertGame } from '@/src/db/games';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function baseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost';
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const body = (await req.json().catch(() => ({}))) || {};
  const shareId = String(body.shareId || crypto.randomUUID()).trim();
  const shareUrl = String(body.shareUrl || `${baseUrl(req)}/report/${shareId}`).trim();
  const record = {
    id: crypto.randomUUID(),
    shareId,
    shareUrl,
    username: a.user.username,
    finishedAt: new Date().toISOString(),
    finishedDate: new Date().toLocaleDateString('en-US'),
    finishedTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    topic: body.topic,
    concept: body.concept,
    level: body.level,
    settings: body.settings,
    slides: body.slides,       // per-slide question, chosen answer, correct?
    correct: body.correct,
    total: body.total,
    durationSec: body.durationSec,
    recommendations: body.recommendations || null,
    questionSummary: body.questionSummary || null,
    answerSummary: body.answerSummary || null,
    aiNotes: body.aiNotes || null,
  };
  await insertGame(record);
  return NextResponse.json({ ok: true, id: record.id, shareId: record.shareId, shareUrl: record.shareUrl, finishedAt: record.finishedAt });
}

export async function GET(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const games = await readGames();
  return NextResponse.json(a.user.role === 'admin' ? games : games.filter((g: any) => g.username === a.user.username));
}
