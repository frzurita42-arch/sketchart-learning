'use client';
/* Login view. Ported from public/js/views/login.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { useApp } from '@/components/AppContext';

export function LoginView() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const r = await API.post('/api/login', { username: username.trim(), password });
      login(r.token, { username: r.username, role: r.role });
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') go(); };

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <h1>✏️ <span className="scribble-underline">SketchLearn</span></h1>
        <p>AI-drawn lessons that adapt to every answer you give.</p>
      </div>
      <div className="card">
        <label className="field"><span>Username</span>
          <input type="text" id="login-user" autoComplete="username" value={username}
            onChange={e => setUsername(e.target.value)} onKeyDown={onKey} /></label>
        <label className="field"><span>Password</span>
          <input type="password" id="login-pass" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={onKey} /></label>
        <p className="form-error" id="login-err">{err}</p>
        <button className="btn primary" id="login-btn" style={{ width: '100%' }} disabled={busy} onClick={go}>Sign in →</button>
      </div>
    </div>
  );
}
