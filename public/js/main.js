/* SketchLearn SPA entry (ES module): wire the topbar, expose nav for inline
 * onclick handlers, and boot the app. All views/activities/flows live in their
 * own modules imported through the router. */
import { API } from './core/api.js';
import { nav, boot } from './core/router.js';

// Inline onclick="nav(...)" handlers in rendered HTML need nav on the global scope
// (module top-level names are not global).
window.nav = nav;

document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await API.post('/api/logout'); } catch { }
  API.clearSession(); location.reload();
});

boot();
