/* Login view. */
import { API } from '../core/api.js';
import { $app } from '../core/state.js';
import { hideChrome } from '../core/layout.js';
import { boot } from '../core/router.js';

export function viewLogin() {
  hideChrome();
  $app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo"><h1>✏️ <span class="scribble-underline">SketchLearn</span></h1>
        <p>AI-drawn lessons that adapt to every answer you give.</p></div>
      <div class="card">
        <label class="field"><span>Username</span><input type="text" id="login-user" autocomplete="username" /></label>
        <label class="field"><span>Password</span><input type="password" id="login-pass" autocomplete="current-password" /></label>
        <p class="form-error" id="login-err"></p>
        <button class="btn primary" id="login-btn" style="width:100%">Sign in →</button>
      </div>
    </div>`;
  const go = async () => {
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    try {
      const r = await API.post('/api/login', {
        username: document.getElementById('login-user').value.trim(),
        password: document.getElementById('login-pass').value
      });
      API.setSession(r.token, { username: r.username, role: r.role });
      boot();
    } catch (e) {
      document.getElementById('login-err').textContent = e.message;
      btn.disabled = false;
    }
  };
  document.getElementById('login-btn').addEventListener('click', go);
  $app.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
}
