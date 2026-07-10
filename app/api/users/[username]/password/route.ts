import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { userState, hashPassword, persistUsers } from '@/src/db/users';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { username } = await params;
  const { password } = (await req.json().catch(() => ({}))) || {};
  if (!password) return NextResponse.json({ error: 'Password required' }, { status: 400 });
  if (a.user.username !== username && a.user.role !== 'admin') {
    return NextResponse.json({ error: 'You can only change your own password' }, { status: 403 });
  }
  const user = userState.users.find((u: any) => u.username === username);
  if (!user) return NextResponse.json({ error: 'No such user' }, { status: 404 });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.salt);
  await persistUsers(userState.users);
  return NextResponse.json({ ok: true });
}
