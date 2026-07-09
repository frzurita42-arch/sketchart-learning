/* Thin fetch wrapper with auth token */
const API = {
  token: localStorage.getItem('sl_token') || null,
  user: JSON.parse(localStorage.getItem('sl_user') || 'null'),

  setSession(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('sl_token', token);
    localStorage.setItem('sl_user', JSON.stringify(user));
  },
  clearSession() {
    this.token = null; this.user = null;
    localStorage.removeItem('sl_token');
    localStorage.removeItem('sl_user');
  },

  async call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    if (res.status === 401 && this.token) {
      this.clearSession();
      location.reload();
      throw new Error('Session expired. Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },
  get(url) { return this.call('GET', url); },
  post(url, body) { return this.call('POST', url, body); },
  del(url) { return this.call('DELETE', url); }
};
