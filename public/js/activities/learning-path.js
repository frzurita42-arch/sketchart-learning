/* Learning Path activity: the "type a topic / pick a chip" card on the home feed. */
import { state, $app } from '../core/state.js';
import { esc } from '../ui/index.js';
import { renderInstructionPlank, triggerHomePreloads } from '../views/home.js';
import { loadPath } from '../flows/path.js';

export function renderLearningPathSection() {
  return `
    <section style="max-width:860px;margin:18px auto 0">
      <h4 class="activity-heading" style="margin:0 0 6px;opacity:.9;max-width:760px">Start a Learning path</h4>
      ${renderInstructionPlank('Type a topic or tap one below — I sketch a full, playable lesson path for it.')}
      <div class="card alt" style="max-width:560px;margin:12px auto 0">
        <label class="field"><span>Type a topic to learn</span>
          <input type="text" id="custom-topic" placeholder="e.g. Renaissance art, Rust programming, beekeeping…" /></label>
        <button class="btn primary" id="custom-topic-btn">Draw my path →</button>
      </div>
      <div class="chip-row" style="margin-top:16px">${state.homeTopics.map(t => `<button class="chip" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="slide-actions" style="justify-content:center;margin-top:10px">
        <button class="btn small blue" id="refresh-home-topics">↻ Refresh 12 topic ideas</button>
      </div>
    </section>`;
}

export function bindLearningPath() {
  $app.querySelectorAll('[data-topic]').forEach(b => b.addEventListener('click', () => {
    triggerHomePreloads(b.dataset.topic || '');
    state.suggestedSettings = null;
    state.suggestedGuidance = '';
    loadPath(b.dataset.topic);
  }));
  const custom = () => {
    const t = document.getElementById('custom-topic').value.trim();
    if (t) {
      triggerHomePreloads(t);
      state.suggestedSettings = null;
      state.suggestedGuidance = '';
      loadPath(t);
    }
  };
  document.getElementById('custom-topic-btn').addEventListener('click', custom);
  document.getElementById('custom-topic').addEventListener('keydown', e => { if (e.key === 'Enter') custom(); });
}
