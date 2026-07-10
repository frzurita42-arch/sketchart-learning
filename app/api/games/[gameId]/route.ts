import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { deleteGameRecord } from '@/src/db/games';
import { requireAdmin } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const a = await requireAdmin(req);
  if (!a.ok) return a.response;
  const { gameId } = await params;
  const deleted = await deleteGameRecord(gameId);
  if (!deleted) return NextResponse.json({ error: 'No such game' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
