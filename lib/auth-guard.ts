import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { verifyAuthToken } from '@/src/auth';
import { db } from '@/src/db/pool';
import { userState, loadUsers } from '@/src/db/users';
import { ensureReady } from '@/lib/bootstrap';

/* Shared auth guard, ported from src/auth.js `auth` + `adminOnly` middleware.
 *
 * Reads the Bearer token, verifies the signed stateless token, loads the user
 * from the shared in-memory holder (refreshing from Postgres if needed), and
 * returns the same 401/403 shapes the legacy middleware returned. */

export type LegacyUser = { username: string; role: string; [k: string]: any };

export type AuthResult =
  | { ok: true; user: LegacyUser }
  | { ok: false; response: NextResponse };

function bearer(req: Request): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

export async function requireAuth(req: Request): Promise<AuthResult> {
  await ensureReady();
  try {
    const payload: any = verifyAuthToken(bearer(req));
    if (!payload) {
      return { ok: false, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
    }
    const username = payload.u;
    let user = userState.users.find((u: any) => u.username === username) || null;
    if (!user && db.pool) {
      userState.users = await loadUsers();
      user = userState.users.find((u: any) => u.username === username) || null;
    }
    if (!user) {
      return { ok: false, response: NextResponse.json({ error: 'Unknown user' }, { status: 401 }) };
    }
    return { ok: true, user };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Auth failed' }, { status: 500 }) };
  }
}

export async function requireAdmin(req: Request): Promise<AuthResult> {
  const result = await requireAuth(req);
  if (!result.ok) return result;
  if (result.user.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  }
  return result;
}
