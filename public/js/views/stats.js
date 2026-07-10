/* My Stats view: the learner's history table + CSV export + password change. */
import { API } from '../core/api.js';
import { $app } from '../core/state.js';
import { downloadCsv } from '../core/util.js';
import { esc } from '../ui/index.js';
import { loadingHTML } from '../ui/index.js';

export async function viewStats() {
  $app.innerHTML = loadingHTML('Fetching your sketchbook…');
  let games = [];
  try { games = await API.get('/api/games'); }
  catch (e) { $app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const mine = games.filter(g => g.username === API.user.username);
  const totalCorrect = mine.reduce((s, g) => s + (g.correct || 0), 0);
  const totalQ = mine.reduce((s, g) => s + (g.total || 0), 0);
  const totalTime = mine.reduce((s, g) => s + (g.durationSec || 0), 0);
  const isAdmin = API.user.role === 'admin';
  const emptyColspan = isAdmin ? 11 : 10;
  const normalizeList = (value, fallback = []) => {
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
    const text = String(value || '').trim();
    if (!text) return fallback;
    return text.split(/\s*[·,|]\s*/).map(v => v.trim()).filter(Boolean);
  };
  const renderListCell = (items, emptyText = '') => {
    const list = normalizeList(items, Array.isArray(emptyText) ? emptyText : (emptyText ? [emptyText] : []));
    if (!list.length) return esc(emptyText);
    return `<ul class="sheet-list">${list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  };
  $app.innerHTML = `
    <h1 class="view-title">My <span class="scribble-underline">stats</span></h1>
    <div class="stat-row">
      <div class="stat-tile"><div class="big">${mine.length}</div>activities</div>
      <div class="stat-tile"><div class="big">${totalQ ? Math.round(100 * totalCorrect / totalQ) : 0}%</div>avg score</div>
      <div class="stat-tile"><div class="big">${Math.round(totalTime / 60)}m</div>time learning</div>
    </div>
    <div class="stats-layout">
      <div class="stats-main card">
        <div class="table-wrap"><table class="sketch">
          <tr><th>Date</th><th>Time</th><th>Topic</th><th>Concept</th><th>Level</th><th>Score</th><th>Question summary</th><th>Answer summary</th><th>AI notes</th><th>Share</th>${isAdmin ? '<th>Admin</th>' : ''}</tr>
          ${mine.slice().reverse().map(g => `<tr class="stats-row" data-game-id="${esc(g.id || '')}">
            <td>${esc(g.finishedDate || new Date(g.finishedAt).toLocaleDateString())}</td>
            <td>${esc(g.finishedTime || new Date(g.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td>
            <td>${esc(g.topic)}</td><td>${esc(g.concept)}</td>
            <td>${esc(g.level)}</td><td>${g.correct}/${g.total}</td>
            <td class="summary-cell">${renderListCell(g.questionSummary, (g.slides || []).map(s => s.question).filter(Boolean).join(' · '))}</td>
            <td class="summary-cell">${renderListCell(g.answerSummary, (g.slides || []).map(s => s.chosen).filter(Boolean).join(' · '))}</td>
            <td class="summary-cell">${renderListCell(g.aiNotes, g.recommendations?.summary ? [g.recommendations.summary] : '')}</td>
            <td>${(g.shareUrl || g.shareId || g.id) ? `<a href="${esc(g.shareUrl || `/report/${encodeURIComponent(g.shareId || g.id)}`)}" target="_blank" rel="noreferrer">open</a>` : ''}</td>
            ${isAdmin ? `<td>${g.id ? `<button class="btn small ghost delete-game" data-game-id="${esc(g.id)}">Delete</button>` : ''}</td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${emptyColspan}">Nothing yet — go learn something!</td></tr>`}
        </table></div>
        <div class="slide-actions" style="justify-content:flex-start">
          <button class="btn small" id="export-csv">⬇ Download progress spreadsheet (CSV)</button>
          <button class="btn small ghost" id="change-pass">Change my password</button>
        </div>
      </div>
    </div>`;
  document.getElementById('export-csv').addEventListener('click', downloadCsv);
  document.getElementById('change-pass').addEventListener('click', async () => {
    const p = prompt('New password:');
    if (!p) return;
    try { await API.post(`/api/users/${encodeURIComponent(API.user.username)}/password`, { password: p }); alert('Password changed!'); }
    catch (e) { alert(e.message); }
  });
  $app.querySelectorAll('.delete-game').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const gameId = btn.dataset.gameId;
    if (!gameId || !confirm('Delete this lesson record?')) return;
    try {
      await API.del(`/api/games/${encodeURIComponent(gameId)}`);
      viewStats();
    } catch (err) {
      alert(err.message);
    }
  }));
}
