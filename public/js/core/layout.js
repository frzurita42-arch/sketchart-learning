/* Shared site layout (chrome). The top nav markup lives in index.html's shell;
 * this module owns the site-wide footer and toggles all chrome visibility, so
 * the header + footer that wrap every view are managed in one place. */
import { $topbar, $footer } from './state.js';

// The footer shown under every view once the learner is signed in.
export function renderSiteFooter() {
  return `<p>SketchLearn · Adaptive learning cards powered by your goals and progress.</p>`;
}

// Reveal the header + footer (call when a session is active).
export function showChrome() {
  $topbar.classList.remove('hidden');
  if ($footer) {
    $footer.innerHTML = renderSiteFooter();
    $footer.classList.remove('hidden');
  }
}

// Hide the header + footer (the login screen has no chrome).
export function hideChrome() {
  $topbar.classList.add('hidden');
  if ($footer) $footer.classList.add('hidden');
}
