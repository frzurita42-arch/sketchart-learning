/* Routing: view switching, boot, and the demo-mode banner. */
import { API } from './api.js';
import { state, $app, $topbar } from './state.js';
import { viewLogin } from '../views/login.js';
import { viewHome } from '../views/home.js';
import { viewPath, viewSettings } from '../flows/path.js';
import { viewChat } from '../views/chat.js';
import { viewStats } from '../views/stats.js';
import { viewDashboard } from '../views/dashboard.js';

export function nav(view) {
  if (state.game && !state.game.finished && view !== 'activity' &&
      !confirm('Leave the current activity? Your progress will be lost.')) return;
  if (view !== 'activity') state.game = null;
  const views = { home: viewHome, path: viewPath, settings: viewSettings, activity: null, chat: viewChat, stats: viewStats, dashboard: viewDashboard };
  (views[view] || viewHome)();
  window.scrollTo(0, 0);
}

export function boot() {
  if (!API.token) return viewLogin();
  $topbar.classList.remove('hidden');
  document.getElementById('whoami').textContent = `☺ ${API.user.username}`;
  document.getElementById('nav-dashboard').classList.toggle('hidden', API.user.role !== 'admin');
  viewHome();
  checkDemoMode();
}

// Show a banner when the server has no AI provider connected, so placeholder
// lessons/suggestions are clearly demo content rather than looking like bugs.
export async function checkDemoMode() {
  if (sessionStorage.getItem('sl_demo_dismissed') === '1') return;
  let cfg;
  try { cfg = await API.get('/api/config'); } catch { return; }
  if (!cfg || cfg.aiEnabled) { const el = document.getElementById('demo-banner'); if (el) el.remove(); return; }
  if (document.getElementById('demo-banner')) return;
  const el = document.createElement('div');
  el.id = 'demo-banner';
  el.className = 'demo-banner';
  el.innerHTML = `<span><b>Demo mode</b> — no AI provider is connected, so lessons, charts and suggestions use built-in placeholder content. Set <b>GEMINI_API_KEY</b> or <b>DEEPSEEK_API_KEY</b> in your deployment for real AI lessons.</span>` +
    `<button id="demo-banner-x" aria-label="Dismiss">×</button>`;
  document.body.insertBefore(el, $app);
  document.getElementById('demo-banner-x').addEventListener('click', () => {
    sessionStorage.setItem('sl_demo_dismissed', '1');
    el.remove();
  });
}
