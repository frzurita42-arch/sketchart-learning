/* Home view: the activity feed. Renders the four activity cards (each in its own
 * activities/*.js module) and wires their handlers. */
import { API } from '../core/api.js';
import { state, $app, PRESET_TOPICS } from '../core/state.js';
import { shuffled, withTimeout } from '../core/util.js';
import { renderLearningPathSection, bindLearningPath } from '../activities/learning-path.js';
import { renderSuggestedTopicSection, bindSuggested, refreshSuggestedTopic } from '../activities/suggested-topic.js';
import { renderTimeTravelActivitySection, bindTimeTravel } from '../activities/time-travel.js';
import { renderStructuredExplanationsSection, bindStructured } from '../activities/structured-explanations.js';

/* ---------------- home: pick a topic ---------------- */
export function viewHome() {
  state.homeTopics = shuffled(PRESET_TOPICS);
  $app.innerHTML = `
    <h1 class="view-title">What do you want to <span class="scribble-underline">learn</span> today?</h1>
    <p class="view-sub">Pick a subject, or write your own.</p>
    <div class="slide-actions" style="justify-content:center;margin:10px 0 10px;border-top:3px dashed var(--ink);padding-top:14px">
      <button class="btn small" id="refresh-home-feed">↻ Refresh feed</button>
    </div>
    ${renderHomeFeed()}`;

  document.getElementById('refresh-home-feed').addEventListener('click', () => {
    viewHomeWithCurrentTopics();
  });

  document.getElementById('refresh-home-topics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Refreshing ideas…';
    try {
      const r = await withTimeout(API.post('/api/ai/topics', {
        count: 12,
        avoid: state.homeTopics,
        refresh: true,
        triggerTopic: state.topic || ''
      }), 25000, 'Topic refresh timed out. Please retry.');
      if (!r || !Array.isArray(r.topics)) return;
      const fromAI = r.topics.map(t => t.name).filter(Boolean);
      if (fromAI.length) state.homeTopics = shuffled(fromAI).slice(0, 12);
      triggerHomePreloads(state.homeTopics[0] || '');
      viewHomeWithCurrentTopics();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = oldLabel;
      alert(`Could not refresh topics: ${err.message}`);
    }
  });

  bindLearningPath();
  bindSuggested();
  bindTimeTravel();
  bindStructured();
  refreshHomeTopics({ silent: true, forceRefresh: false });
  refreshSuggestedTopic({ silent: true, forceRefresh: false });
}

export function viewHomeWithCurrentTopics() {
  $app.innerHTML = `
    <h1 class="view-title">What do you want to <span class="scribble-underline">learn</span> today?</h1>
    <p class="view-sub">Pick a subject, or write your own.</p>
    <div class="slide-actions" style="justify-content:center;margin:10px 0 10px;border-top:3px dashed var(--ink);padding-top:14px">
      <button class="btn small" id="refresh-home-feed">↻ Refresh feed</button>
    </div>
    ${renderHomeFeed()}`;

  document.getElementById('refresh-home-feed').addEventListener('click', () => {
    viewHomeWithCurrentTopics();
  });

  document.getElementById('refresh-home-topics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Refreshing ideas…';
    try {
      const r = await withTimeout(API.post('/api/ai/topics', {
        count: 12,
        avoid: state.homeTopics,
        refresh: true,
        triggerTopic: state.topic || ''
      }), 25000, 'Topic refresh timed out. Please retry.');
      if (!r || !Array.isArray(r.topics)) return;
      const fromAI = r.topics.map(t => t.name).filter(Boolean);
      if (fromAI.length) state.homeTopics = shuffled(fromAI).slice(0, 12);
      triggerHomePreloads(state.homeTopics[0] || '');
      viewHomeWithCurrentTopics();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = oldLabel;
      alert(`Could not refresh topics: ${err.message}`);
    }
  });

  bindLearningPath();
  bindSuggested();
  bindTimeTravel();
  bindStructured();
}

export function triggerHomePreloads(triggerTopic = '') {
  API.post('/api/ai/topics/preload', {
    triggerTopic,
    avoid: [state.topic, ...(state.homeTopics || [])].filter(Boolean)
  }).catch(() => {});

  API.post('/api/ai/suggested-topic/preload', {
    triggerTopic,
    avoidTopics: [state.topic, ...(state.homeTopics || []), state.homeSuggestion?.topic].filter(Boolean)
  }).catch(() => {});
}

async function refreshHomeTopics({ silent = false, forceRefresh = false } = {}) {
  try {
    const r = await withTimeout(API.post('/api/ai/topics', {
      count: 12,
      avoid: [state.topic].filter(Boolean),
      refresh: !!forceRefresh,
      triggerTopic: state.topic || ''
    }), 15000, 'Home topics timed out.');
    if (!r || !Array.isArray(r.topics)) return;
    const fromCache = r.topics.map(t => t.name).filter(Boolean);
    if (fromCache.length) {
      state.homeTopics = fromCache.slice(0, 12);
      viewHomeWithCurrentTopics();
    }
  } catch (err) {
    if (!silent) alert(`Could not load home topics: ${err.message}`);
  }
}

// A slab of wood with a white paper note pinned on it, carrying the activity's
// how-to, shown centered under each activity title.
export function renderInstructionPlank(html) {
  return `<div class="instruction-plank"><div class="plank-note"><p>${html}</p></div></div>`;
}

function renderHomeFeed() {
  const sections = shuffled([
    renderLearningPathSection(),
    renderSuggestedTopicSection(),
    renderTimeTravelActivitySection(),
    renderStructuredExplanationsSection()
  ]);
  return `${sections.join('')} ${renderHomeFooter()}`;
}

function renderHomeFooter() {
  return `
    <footer class="home-footer">
      <p>SketchLearn · Adaptive learning cards powered by your goals and progress.</p>
    </footer>`;
}
