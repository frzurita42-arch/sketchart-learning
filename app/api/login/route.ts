import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { AUTH_TOKEN_TTL_SEC } from '@/src/config';
import { db } from '@/src/db/pool';
import { userState, hashPassword, loadUsers } from '@/src/db/users';
import { signAuthToken } from '@/src/auth';
import { ensureReady } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureReady();
  const { username, password } = (await req.json().catch(() => ({}))) || {};
  if (db.pool) userState.users = await loadUsers();
  const user = userState.users.find((u: any) => u.username === username);
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  const token = signAuthToken({ u: user.username, iat: now, exp: now + AUTH_TOKEN_TTL_SEC, v: 1 });
  return NextResponse.json({ token, username: user.username, role: user.role });
}
