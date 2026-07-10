import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { userState, makeUser, persistUsers } from '@/src/db/users';
import { readGames } from '@/src/db/games';
import { requireAdmin } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (!a.ok) return a.response;
  const games = await readGames();
  return NextResponse.json(userState.users.map((u: any) => ({
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    gamesPlayed: games.filter((g: any) => g.username === u.username).length,
  })));
}

export async function POST(req: Request) {
  const a = await requireAdmin(req);
  if (!a.ok) return a.response;
  const { username, password, role } = (await req.json().catch(() => ({}))) || {};
  if (!username || !password) return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  if (userState.users.some((u: any) => u.username === username)) return NextResponse.json({ error: 'User already exists' }, { status: 409 });
  userState.users.push(makeUser(username.trim(), password, role === 'admin' ? 'admin' : 'user'));
  await persistUsers(userState.users);
  return NextResponse.json({ ok: true });
}
