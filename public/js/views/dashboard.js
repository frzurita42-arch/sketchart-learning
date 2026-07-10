/* Admin dashboard view: user management + all-game statistics. */
import { API } from '../core/api.js';
import { $app } from '../core/state.js';
import { downloadCsv } from '../core/util.js';
import { esc, loadingHTML } from '../ui/index.js';
import { viewHome } from './home.js';

export async function viewDashboard() {
  if (API.user.role !== 'admin') return viewHome();
  $app.innerHTML = loadingHTML('Opening the teacher’s desk…');
  let usersList = [], games = [];
  try {
    [usersList, games] = await Promise.all([API.get('/api/users'), API.get('/api/games')]);
  } catch (e) { $app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }

  $app.innerHTML = `
    <h1 class="view-title">Teacher’s <span class="scribble-underline">dashboard</span></h1>
    <div class="card">
      <h3>👥 Users</h3>
      <div class="table-wrap"><table class="sketch">
        <tr><th>Username</th><th>Role</th><th>Created</th><th>Games</th><th>Actions</th></tr>
        ${usersList.map(u => `<tr>
          <td>${esc(u.username)}</td><td>${esc(u.role)}</td>
          <td>${new Date(u.createdAt).toLocaleDateString()}</td><td>${u.gamesPlayed}</td>
          <td>
            <button class="btn small" data-pass="${esc(u.username)}">Set password</button>
            ${u.username !== API.user.username ? `<button class="btn small ghost" data-del="${esc(u.username)}">✘ delete</button>` : ''}
          </td></tr>`).join('')}
      </table></div>
      <h3 style="margin-top:18px">➕ Add a user</h3>
      <div class="settings-grid" style="margin-top:8px">
        <label class="field"><span>Username</span><input type="text" id="new-user" /></label>
        <label class="field"><span>Password</span><input type="text" id="new-pass" /></label>
        <label class="field"><span>Role</span><select id="new-role"><option value="user">user</option><option value="admin">admin</option></select></label>
      </div>
      <p class="form-error" id="user-err"></p>
      <button class="btn green" id="add-user-btn">Add user</button>
    </div>
    <div class="card alt">
      <h3>📊 All game statistics</h3>
      <div class="table-wrap"><table class="sketch">
        <tr><th>User</th><th>Date</th><th>Topic</th><th>Concept</th><th>Level</th><th>Score</th><th>Time</th></tr>
        ${games.slice().reverse().map(g => `<tr>
          <td>${esc(g.username)}</td><td>${new Date(g.finishedAt).toLocaleString()}</td>
          <td>${esc(g.topic)}</td><td>${esc(g.concept)}</td><td>${esc(g.level)}</td>
          <td>${g.correct}/${g.total}</td><td>${Math.floor(g.durationSec / 60)}:${String(g.durationSec % 60).padStart(2, '0')}</td>
        </tr>`).join('') || '<tr><td colspan="7">No games played yet.</td></tr>'}
      </table></div>
      <div class="slide-actions" style="justify-content:flex-start">
        <button class="btn small" id="dash-export">⬇ Export all as CSV</button>
      </div>
    </div>`;

  document.getElementById('add-user-btn').addEventListener('click', async () => {
    try {
      await API.post('/api/users', {
        username: document.getElementById('new-user').value.trim(),
        password: document.getElementById('new-pass').value,
        role: document.getElementById('new-role').value
      });
      viewDashboard();
    } catch (e) { document.getElementById('user-err').textContent = e.message; }
  });
  $app.querySelectorAll('[data-pass]').forEach(b => b.addEventListener('click', async () => {
    const p = prompt(`New password for ${b.dataset.pass}:`);
    if (!p) return;
    try { await API.post(`/api/users/${encodeURIComponent(b.dataset.pass)}/password`, { password: p }); alert('Password updated.'); }
    catch (e) { alert(e.message); }
  }));
  $app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Delete user ${b.dataset.del}? Their game history stays in the records.`)) return;
    try { await API.del(`/api/users/${encodeURIComponent(b.dataset.del)}`); viewDashboard(); }
    catch (e) { alert(e.message); }
  }));
  document.getElementById('dash-export').addEventListener('click', downloadCsv);
}
