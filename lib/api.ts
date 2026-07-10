'use client';
/* Typed fetch client with the signed-token session, ported from
 * public/js/core/api.js. A client-side singleton: the token/user live in
 * localStorage and in memory, exactly like the legacy SPA. */

export interface SessionUser {
  username: string;
  role: string;
}

class ApiClient {
  token: string | null = null;
  user: SessionUser | null = null;

  private hydrate() {
    if (typeof window === 'undefined') return;
    if (this.token === null) this.token = localStorage.getItem('sl_token');
    if (this.user === null) {
      try { this.user = JSON.parse(localStorage.getItem('sl_user') || 'null'); } catch { this.user = null; }
    }
  }

  setSession(token: string, user: SessionUser) {
    this.token = token;
    this.user = user;
    localStorage.setItem('sl_token', token);
    localStorage.setItem('sl_user', JSON.stringify(user));
  }

  clearSession() {
    this.token = null;
    this.user = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sl_token');
      localStorage.removeItem('sl_user');
    }
  }

  async call(method: string, url: string, body?: any): Promise<any> {
    this.hydrate();
    const controller = new AbortController();
    const timeoutMs = 30000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err && err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    if (res.status === 401 && this.token) {
      this.clearSession();
      location.reload();
      throw new Error('Session expired. Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  get(url: string) { return this.call('GET', url); }
  post(url: string, body?: any) { return this.call('POST', url, body); }
  del(url: string) { return this.call('DELETE', url); }
}

export const API = new ApiClient();
