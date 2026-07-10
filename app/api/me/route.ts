import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  return NextResponse.json({ username: a.user.username, role: a.user.role });
}
