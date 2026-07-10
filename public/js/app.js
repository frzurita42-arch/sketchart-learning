/* SketchLearn SPA */
const $app = document.getElementById('app');
const $topbar = document.getElementById('topbar');

const PRESET_TOPICS = ['Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Literature', 'Programming', 'Economics', 'Music Theory', 'Astronomy', 'Psychology'];
const LEVELS = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
const TONES = ['Friendly lecture', 'Casual conversation', 'Hopeful & encouraging', 'Pessimistic & cautionary', 'Humorous', 'Storytelling', 'Socratic questioning'];

const state = {
  topic: null,
  path: null,
  homeTopics: [],
  homeSuggestion: null,
  timeTravel: {
    headline: '',
    period: 'future',
    level: 'Lower Intermediate',
    complexity: 'standard',
    paragraphLength: 'medium',
    paragraphCount: 3,
    imageDensity: 'balanced',
    totalSlides: 7,
    tone: 'Storytelling'
  },
  latexLab: {
    prompt: '',
    exampleType: 'proof',
    level: 'Upper Intermediate',
    tone: 'Friendly lecture',
    complexity: 'standard',
    paragraphLength: 'medium',
    imageDensity: 'balanced',
    totalSlides: 8,
    continuation: 'related-topics',
    alternateVisualMath: true
  },
  suggestedSettings: null,
  suggestedGuidance: '',
  concept: null,
  level: null,
  settings: null,
  game: null,
  chat: [{ role: 'assistant', content: "Hi! I'm your SketchLearn coach. I can see your progress spreadsheet and help you pick what to study next, or explain how to use the site. What are you curious about?" }]
};

function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function withTimeout(promise, ms, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'Request timed out')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/* ---------------- routing ---------------- */
function nav(view) {
  if (state.game && !state.game.finished && view !== 'activity' &&
      !confirm('Leave the current activity? Your progress will be lost.')) return;
  if (view !== 'activity') state.game = null;
  const views = { home: viewHome, path: viewPath, settings: viewSettings, activity: null, chat: viewChat, stats: viewStats, dashboard: viewDashboard };
  (views[view] || viewHome)();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await API.post('/api/logout'); } catch { }
  API.clearSession(); location.reload();
});

function boot() {
  if (!API.token) return viewLogin();
  $topbar.classList.remove('hidden');
  document.getElementById('whoami').textContent = `☺ ${API.user.username}`;
  document.getElementById('nav-dashboard').classList.toggle('hidden', API.user.role !== 'admin');
  viewHome();
  checkDemoMode();
}

// Show a banner when the server has no AI provider connected, so placeholder
// lessons/suggestions are clearly demo content rather than looking like bugs.
async function checkDemoMode() {
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

/* ---------------- login ---------------- */
function viewLogin() {
  $topbar.classList.add('hidden');
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

/* ---------------- home: pick a topic ---------------- */
function viewHome() {
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

  bindHomeTopicHandlers();
  bindSuggestedTopicHandlers();
  refreshHomeTopics({ silent: true, forceRefresh: false });
  refreshSuggestedTopic({ silent: true, forceRefresh: false });
}

function viewHomeWithCurrentTopics() {
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

  bindHomeTopicHandlers();
  bindSuggestedTopicHandlers();
}

function bindHomeTopicHandlers() {
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

function triggerHomePreloads(triggerTopic = '') {
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
function renderInstructionPlank(html) {
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

function renderLearningPathSection() {
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

function renderHomeFooter() {
  return `
    <footer class="home-footer">
      <p>SketchLearn · Adaptive learning cards powered by your goals and progress.</p>
    </footer>`;
}

function renderSuggestedTopicSection() {
  const s = state.homeSuggestion;
  const settings = s?.settings || {};
  const hasSuggestion = !!(s && s.topic && !s.error);
  const setupReceipt = [
    `Level: ${settings.level || 'Upper Intermediate'}`,
    `Slides: ${String(settings.totalSlides || 7)}`,
    `Paragraph: ${settings.paragraphLength || 'medium'}`,
    `Para/slide: ${String(settings.paragraphCount || 3)}`,
    `Tone: ${settings.tone || 'Friendly lecture'}`,
    `Complexity: ${settings.complexity || 'standard'}`,
    `Visual: ${settings.imageDensity || 'balanced'}`
  ].join(' | ');
  return `
    <section style="max-width:760px;margin:36px auto 0">
      <h4 class="activity-heading" style="margin:0 0 2px;opacity:.9">Suggested topic</h4>
      ${renderInstructionPlank('A topic picked from your history. Refresh for another, or press play to start.')}
      <div class="card" style="max-width:760px;margin:0 auto 0;padding:14px 16px">
      <div class="slide-actions" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        ${hasSuggestion ? `<p style="margin:0;font-weight:700">${esc(s.topic)}</p>` : ''}
        <button class="btn small blue" id="refresh-suggested-topic">↻ Refresh suggestion</button>
      </div>
      ${hasSuggestion ? `
        <div class="summary-card" style="padding:10px 12px;border-radius:14px">
          <p style="margin:0;font-size:.95rem">${esc(s.why || '')}</p>
          ${Array.isArray(s.honorableMentions) && s.honorableMentions.length ? `<p style="margin:6px 0 0;font-size:.9rem"><b>Mentions:</b> ${s.honorableMentions.map(v => esc(v)).join(' · ')}</p>` : ''}
          <p style="margin:8px 0 0;padding:8px 10px;border:1px dashed #2d2a26;border-radius:10px;background:#fff8da;font-size:.88rem"><b>Recommended setup:</b> ${esc(setupReceipt)}</p>
          ${s.customMessage ? `<p style="margin:6px 0 0;font-size:.88rem"><b>Prompt:</b> ${esc(s.customMessage)}</p>` : ''}
        </div>
        <div class="slide-actions" style="justify-content:flex-start;margin-top:10px">
          <button class="btn green" id="use-suggested-topic">Use this suggestion →</button>
        </div>
      ` : s?.error
          ? `<p style="opacity:.85">${esc(s.why || 'Could not load suggestion right now. Press refresh to retry.')}</p>`
          : '<p style="opacity:.75">Generating your suggestion…</p>'}
      </div>
    </section>`;
}

function renderTimeTravelActivitySection() {
  const tt = state.timeTravel || {};
  return `
      <section style="max-width:760px;margin:24px auto 0">
      <h4 class="activity-heading" style="margin:0 0 6px;opacity:.9">Time Travel Activity</h4>
      ${renderInstructionPlank('Set an era and a headline — it becomes a playable news story lesson with quizzes.')}
      <div class="card alt" style="max-width:760px;margin:0 auto 0;padding:14px 16px">
        <div class="slide-actions" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-weight:600">Custom headline</span>
          <button class="btn small blue" id="tt-random-headline">${tt.headline ? '↻ Refresh headline' : '🎲 Random headline'}</button>
        </div>
        <label class="field"><span style="display:none">Custom headline</span>
          <input type="text" id="tt-headline" value="${esc(tt.headline || '')}" placeholder="e.g. City on Mars unveils first interplanetary water treaty" /></label>
        <div class="card" style="padding:12px;margin-top:8px">
          <div class="settings-compact">
            <label class="field"><span>Time period</span>
              <select id="tt-period">
                <option value="past" ${tt.period === 'past' ? 'selected' : ''}>Past</option>
                <option value="present" ${tt.period === 'present' ? 'selected' : ''}>Present</option>
                <option value="future" ${tt.period === 'future' ? 'selected' : ''}>Future</option>
              </select></label>
            <label class="field"><span>Reading level</span>
              <select id="tt-level">${LEVELS.map(l => `<option ${tt.level === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="field"><span>Difficulty</span>
              <select id="tt-complexity">
                <option value="simple" ${tt.complexity === 'simple' ? 'selected' : ''}>Simple</option>
                <option value="standard" ${tt.complexity === 'standard' ? 'selected' : ''}>Standard</option>
                <option value="scholarly" ${tt.complexity === 'scholarly' ? 'selected' : ''}>Scholarly</option>
              </select></label>
            <label class="field"><span>Paragraph length</span>
              <select id="tt-paragraph-length">
                <option value="brief" ${tt.paragraphLength === 'brief' ? 'selected' : ''}>Brief</option>
                <option value="medium" ${tt.paragraphLength === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="detailed" ${tt.paragraphLength === 'detailed' ? 'selected' : ''}>Detailed</option>
              </select></label>
            <label class="field"><span>Paragraphs per slide</span>
              <input type="number" id="tt-paragraph-count" min="1" max="7" value="${Math.min(7, Math.max(1, parseInt(tt.paragraphCount, 10) || 3))}" /></label>
            <label class="field"><span>Support material ratio</span>
              <select id="tt-density">
                <option value="text-only" ${tt.imageDensity === 'text-only' ? 'selected' : ''}>Text only</option>
                <option value="mostly-text" ${tt.imageDensity === 'mostly-text' ? 'selected' : ''}>Mostly text</option>
                <option value="balanced" ${tt.imageDensity === 'balanced' ? 'selected' : ''}>Balanced</option>
                <option value="mostly-visual" ${tt.imageDensity === 'mostly-visual' ? 'selected' : ''}>Mostly support material</option>
              </select></label>
            <label class="field"><span>Slides</span>
              <input type="number" id="tt-slides" min="2" max="20" value="${Math.min(20, Math.max(2, parseInt(tt.totalSlides, 10) || 7))}" /></label>
          </div>
        </div>
        <div class="slide-actions" style="justify-content:flex-start;margin-top:10px">
          <button class="btn green" id="tt-start-story">Generate story path →</button>
        </div>
      </div>
    </section>`;
}

function renderStructuredExplanationsSection() {
  const ml = state.latexLab || {};
  return `
      <section style="max-width:760px;margin:24px auto 0">
        <h4 class="activity-heading" style="margin:0 0 6px;opacity:.9">Structured Explanations</h4>
      ${renderInstructionPlank('Name a formula or concept — get a step-by-step proof or worked example as playable slides.')}
      <div class="card alt" style="max-width:760px;margin:0 auto 0;padding:14px 16px">
        <div class="slide-actions" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-weight:600">Formula, concept, or example type</span>
          <button class="btn small blue" id="ml-suggest">✨ Suggest topic + settings</button>
        </div>
        <label class="field"><span style="display:none">Formula, concept, or example type</span>
          <input type="text" id="ml-prompt" value="${esc(ml.prompt || '')}" placeholder="e.g. Bayes theorem, Taylor series, shortest-path proof, decision tree split criteria" /></label>
        <div class="card" style="padding:12px;margin-top:8px">
          <div class="settings-compact">
            <label class="field"><span>Focus mode</span>
              <select id="ml-example-type">
                <option value="proof" ${ml.exampleType === 'proof' ? 'selected' : ''}>Formal proof / derivation</option>
                <option value="worked-example" ${ml.exampleType === 'worked-example' ? 'selected' : ''}>Worked example</option>
                <option value="graph-table" ${ml.exampleType === 'graph-table' ? 'selected' : ''}>Graph / table analysis</option>
                <option value="tree-diagram" ${ml.exampleType === 'tree-diagram' ? 'selected' : ''}>Tree / diagram playout</option>
                <option value="outline" ${ml.exampleType === 'outline' ? 'selected' : ''}>Concept outline</option>
              </select></label>
            <label class="field"><span>Difficulty level</span>
              <select id="ml-level">${LEVELS.map(l => `<option ${ml.level === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="field"><span>Tone</span>
              <select id="ml-tone">${TONES.map(t => `<option ${ml.tone === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="field"><span>Text complexity</span>
              <select id="ml-complexity">
                <option value="simple" ${ml.complexity === 'simple' ? 'selected' : ''}>Simple</option>
                <option value="standard" ${ml.complexity === 'standard' ? 'selected' : ''}>Standard</option>
                <option value="scholarly" ${ml.complexity === 'scholarly' ? 'selected' : ''}>Scholarly</option>
              </select></label>
            <label class="field"><span>Slides</span>
              <input type="number" id="ml-slides" min="2" max="20" value="${Math.min(20, Math.max(2, parseInt(ml.totalSlides, 10) || 8))}" /></label>
            <label class="field"><span>Paragraph length</span>
              <select id="ml-paragraph-length">
                <option value="brief" ${ml.paragraphLength === 'brief' ? 'selected' : ''}>Brief</option>
                <option value="medium" ${ml.paragraphLength === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="detailed" ${ml.paragraphLength === 'detailed' ? 'selected' : ''}>Detailed</option>
              </select></label>
            <label class="field"><span>Support material ratio</span>
              <select id="ml-density">
                <option value="text-only" ${ml.imageDensity === 'text-only' ? 'selected' : ''}>Text only</option>
                <option value="mostly-text" ${ml.imageDensity === 'mostly-text' ? 'selected' : ''}>Mostly text</option>
                <option value="balanced" ${ml.imageDensity === 'balanced' ? 'selected' : ''}>Balanced</option>
                <option value="mostly-visual" ${ml.imageDensity === 'mostly-visual' ? 'selected' : ''}>Mostly support material</option>
              </select></label>
            <label class="field"><span>Continuation style</span>
              <select id="ml-continuation">
                <option value="more-examples" ${ml.continuation === 'more-examples' ? 'selected' : ''}>Continue with more examples</option>
                <option value="different-examples" ${ml.continuation === 'different-examples' ? 'selected' : ''}>Continue with different examples</option>
                <option value="related-topics" ${ml.continuation === 'related-topics' ? 'selected' : ''}>Continue to related topics</option>
              </select></label>
            <label class="field alt-row"><span><input type="checkbox" id="ml-alternate" ${ml.alternateVisualMath ? 'checked' : ''} style="width:auto;margin-right:8px" />Alternate visual explanation pages with math/proof pages</span></label>
          </div>
        </div>
        <div class="slide-actions" style="justify-content:flex-start;margin-top:10px">
          <button class="btn green" id="ml-start">Generate latex path →</button>
        </div>
      </div>
    </section>`;
}

function bindSuggestedTopicHandlers() {
  const refreshBtn = document.getElementById('refresh-suggested-topic');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshSuggestedTopic({ silent: false, forceRefresh: true }));

  const useBtn = document.getElementById('use-suggested-topic');
  if (useBtn) useBtn.addEventListener('click', () => {
    const s = state.homeSuggestion;
    if (!s || !s.topic) return;
    state.suggestedSettings = {
      totalSlides: parseInt(s.settings?.totalSlides, 10) || 7,
      tone: s.settings?.tone || 'Friendly lecture',
      complexity: s.settings?.complexity || 'standard',
      paragraphLength: s.settings?.paragraphLength || 'medium',
      paragraphCount: parseInt(s.settings?.paragraphCount, 10) || 3,
      imageDensity: s.settings?.imageDensity || 'balanced',
      language: '',
      audience: '',
      customInstructions: String(s.customMessage || '').trim()
    };
    state.suggestedGuidance = String(s.customMessage || '').trim();
    loadPath(s.topic, state.suggestedGuidance || undefined, s.settings?.level ? [s.settings.level] : undefined, { fromHistory: true, fresh: true });
  });

  const randomHeadlineBtn = document.getElementById('tt-random-headline');
  if (randomHeadlineBtn) randomHeadlineBtn.addEventListener('click', () => refreshTimeTravelHeadline());

  const periodSelect = document.getElementById('tt-period');
  if (periodSelect) periodSelect.addEventListener('change', () => {
    const headline = (document.getElementById('tt-headline')?.value || '').trim();
    const preset = randomTimeTravelSettings(periodSelect.value, headline);
    state.timeTravel = { ...state.timeTravel, ...preset, period: periodSelect.value, headline };
    applyTimeTravelSettingsToForm(state.timeTravel);
  });

  const startStoryBtn = document.getElementById('tt-start-story');
  if (startStoryBtn) startStoryBtn.addEventListener('click', () => {
    const period = document.getElementById('tt-period')?.value || 'future';
    const level = document.getElementById('tt-level')?.value || 'Lower Intermediate';
    const complexity = document.getElementById('tt-complexity')?.value || 'standard';
    const paragraphLength = document.getElementById('tt-paragraph-length')?.value || 'medium';
    const paragraphCount = Math.min(7, Math.max(1, parseInt(document.getElementById('tt-paragraph-count')?.value, 10) || 3));
    const imageDensity = document.getElementById('tt-density')?.value || 'balanced';
    const totalSlides = Math.min(20, Math.max(2, parseInt(document.getElementById('tt-slides')?.value, 10) || 7));
    const headline = (document.getElementById('tt-headline')?.value || '').trim() || `Breaking news from the ${period}`;

    state.timeTravel = { headline, period, level, complexity, paragraphLength, paragraphCount, imageDensity, totalSlides, tone: 'Storytelling' };
    state.suggestedSettings = {
      totalSlides,
      tone: 'Storytelling',
      activityType: 'time-travel',
      complexity,
      paragraphLength,
      paragraphCount,
      imageDensity,
      language: '',
      audience: '',
      customInstructions: `Write this as a ${period} news story driven by the headline: "${headline}". Include realistic causes, impacts, and practical solutions.`
    };
    state.suggestedGuidance = `Build a ${period} time-travel news learning story around this headline: "${headline}". Keep it educational and problem-solving focused.`;
    triggerHomePreloads(headline);
    loadPath(headline, state.suggestedGuidance, [level], { fromHistory: true, fresh: true });
  });

  const startLatexBtn = document.getElementById('ml-start');
  if (startLatexBtn) startLatexBtn.addEventListener('click', () => {
    const prompt = (document.getElementById('ml-prompt')?.value || '').trim();
    if (!prompt) {
      alert('Please enter a formula, concept, or example type first.');
      return;
    }
    const exampleType = document.getElementById('ml-example-type')?.value || 'proof';
    const level = document.getElementById('ml-level')?.value || 'Upper Intermediate';
    const tone = document.getElementById('ml-tone')?.value || 'Friendly lecture';
    const complexity = document.getElementById('ml-complexity')?.value || 'standard';
    const totalSlides = Math.min(20, Math.max(2, parseInt(document.getElementById('ml-slides')?.value, 10) || 8));
    const paragraphLength = document.getElementById('ml-paragraph-length')?.value || 'medium';
    const imageDensity = document.getElementById('ml-density')?.value || 'balanced';
    const continuation = document.getElementById('ml-continuation')?.value || 'related-topics';
    const alternate = !!document.getElementById('ml-alternate')?.checked;
    const paragraphCount = complexity === 'scholarly' ? 4 : (complexity === 'simple' ? 2 : 3);

    state.latexLab = {
      prompt,
      exampleType,
      level,
      tone,
      complexity,
      paragraphLength,
      imageDensity,
      totalSlides,
      continuation,
      alternateVisualMath: alternate
    };

    const modeMap = {
      proof: 'formal proof steps and derivations',
      'worked-example': 'step-by-step worked examples',
      'graph-table': 'graphs and tables with interpretation',
      'tree-diagram': 'tree play-out or diagram-based reasoning',
      outline: 'structured outline with key claims and dependencies'
    };
    const continuationMap = {
      'more-examples': 'Continue with more examples of the same type after each core explanation.',
      'different-examples': 'Continue with different examples that test the same principle in varied contexts.',
      'related-topics': 'Continue toward adjacent related topics once the core concept is stabilized.'
    };

    const alternationLine = alternate
      ? 'Alternate slide modes: one slide with visual/story explanation, then one slide with mathematical steps/proof/code/latex. Repeat this alternation.'
      : 'Blend visual and mathematical content on each slide without strict alternation.';

    state.suggestedSettings = {
      totalSlides,
      tone,
      exampleType,
      activityType: 'structured-explanation',
      complexity,
      paragraphLength,
      paragraphCount,
      imageDensity,
      language: '',
      audience: '',
      customInstructions: `Teach "${prompt}" as ${modeMap[exampleType] || modeMap.proof}. ${alternationLine} If this is a proof, every slide must show the actual derivation in LaTeX and continue from the previous slide rather than restarting. Accompany every equation/code/table/graph/diagram with written explanation aligned to ${level} difficulty and ${tone} tone. ${continuationMap[continuation] || continuationMap['related-topics']}`
    };

    state.suggestedGuidance = `Build a rigorous but clear learning path for "${prompt}" focused on ${modeMap[exampleType] || modeMap.proof}. If the example type is proof, every slide must include a displayed LaTeX proof block that continues the derivation from the previous answer. Use visual representations (trees, diagrams, tables, graphs, or sketches) when helpful, and always include explanatory text.`;
    triggerHomePreloads(prompt);
    loadPath(prompt, state.suggestedGuidance, [level], { fromHistory: true, fresh: true });
  });

  const suggestLatexBtn = document.getElementById('ml-suggest');
  if (suggestLatexBtn) suggestLatexBtn.addEventListener('click', () => suggestStructuredExplanation());
}

async function refreshTimeTravelHeadline() {
  const btn = document.getElementById('tt-random-headline');
  const input = document.getElementById('tt-headline');
  const periodEl = document.getElementById('tt-period');
  if (!btn || !input) return;
  btn.disabled = true;
  btn.textContent = 'Generating…';
  const period = periodEl?.value || state.timeTravel?.period || 'future';
  let headline = '';
  try {
    const r = await withTimeout(API.post('/api/ai/time-travel-headline', {
      period,
      avoidHeadlines: [state.timeTravel?.headline, input.value].filter(Boolean)
    }), 15000, 'Headline generation timed out.');
    headline = String(r?.headline || '').trim();
  } catch {
    headline = randomLocalHeadline(period, [state.timeTravel?.headline, input.value]);
  }

  if (!headline) headline = randomLocalHeadline(period, [state.timeTravel?.headline, input.value]);
  input.value = headline;
  const preset = randomTimeTravelSettings(period, headline);
  state.timeTravel = { ...state.timeTravel, ...preset, period, headline };
  applyTimeTravelSettingsToForm(state.timeTravel);
  btn.textContent = '↻ Refresh headline';
  btn.disabled = false;
}

function randomLocalHeadline(period = 'future', avoid = []) {
  const pool = {
    past: [
      'Engineers Rebuild Ancient Port After Great Earthquake',
      'Royal Observatory Corrects Calendar with New Sky Tables',
      'City Council Launches First Public Sanitation Campaign'
    ],
    present: [
      'Coastal City Uses Sensor Network to Cut Flood Damage',
      'Community Team Deploys AI Triage for Emergency Clinics',
      'Schools Partner with Labs to Track Heat Wave Risks'
    ],
    future: [
      'Orbital Cities Vote on Shared Water Protocol for Drought Years',
      'Lunar Freight Network Stabilizes Food Prices Across Colonies',
      'Quantum Forecast Grid Gives Regions 30-Day Storm Lead Time'
    ]
  };
  const list = pool[period] || pool.future;
  const avoidSet = new Set((avoid || []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const options = list.filter(h => !avoidSet.has(h.toLowerCase()));
  const source = options.length ? options : list;
  return source[Math.floor(Math.random() * source.length)] || list[0];
}

function randomTimeTravelSettings(period = 'future', headline = '') {
  const text = String(headline || '').toLowerCase();
  const hardSignal = /quantum|treaty|protocol|systems|forecast|engineering|model|infrastructure|policy/.test(text);
  const visualSignal = /city|storm|flood|space|mars|lunar|harbor|port|network/.test(text);
  const simpleSignal = /school|community|local|students|daily|public/.test(text);

  const levelPool = period === 'past'
    ? ['Beginner', 'Lower Intermediate', 'Upper Intermediate']
    : period === 'present'
      ? ['Lower Intermediate', 'Upper Intermediate', 'Advanced']
      : ['Upper Intermediate', 'Advanced', 'PhD'];
  const tonePool = period === 'past'
    ? ['Storytelling', 'Friendly lecture']
    : period === 'present'
      ? ['Casual conversation', 'Storytelling', 'Hopeful & encouraging']
      : ['Storytelling', 'Socratic questioning', 'Friendly lecture'];

  const level = levelPool[Math.floor(Math.random() * levelPool.length)];
  const complexity = simpleSignal ? 'simple' : (hardSignal ? (Math.random() < 0.6 ? 'scholarly' : 'standard') : 'standard');
  const paragraphLength = hardSignal ? (Math.random() < 0.5 ? 'detailed' : 'medium') : (Math.random() < 0.5 ? 'brief' : 'medium');
  const paragraphCount = hardSignal ? (3 + Math.floor(Math.random() * 3)) : (2 + Math.floor(Math.random() * 3));
  const imageDensity = visualSignal ? (Math.random() < 0.65 ? 'mostly-visual' : 'balanced') : (Math.random() < 0.7 ? 'balanced' : 'mostly-text');
  const totalSlides = hardSignal ? (8 + Math.floor(Math.random() * 6)) : (5 + Math.floor(Math.random() * 5));
  const tone = tonePool[Math.floor(Math.random() * tonePool.length)];

  return {
    level,
    complexity,
    paragraphLength,
    paragraphCount: Math.min(7, Math.max(1, paragraphCount)),
    imageDensity,
    totalSlides: Math.min(20, Math.max(2, totalSlides)),
    tone
  };
}

function applyTimeTravelSettingsToForm(tt = {}) {
  const ids = ['tt-level', 'tt-complexity', 'tt-paragraph-length', 'tt-paragraph-count', 'tt-density', 'tt-slides'];
  if (!ids.every(id => document.getElementById(id))) return;
  if (tt.level) document.getElementById('tt-level').value = tt.level;
  if (tt.complexity) document.getElementById('tt-complexity').value = tt.complexity;
  if (tt.paragraphLength) document.getElementById('tt-paragraph-length').value = tt.paragraphLength;
  if (tt.paragraphCount) document.getElementById('tt-paragraph-count').value = String(Math.min(7, Math.max(1, parseInt(tt.paragraphCount, 10) || 3)));
  if (tt.imageDensity) document.getElementById('tt-density').value = tt.imageDensity;
  if (tt.totalSlides) document.getElementById('tt-slides').value = String(Math.min(20, Math.max(2, parseInt(tt.totalSlides, 10) || 7)));
}

async function suggestStructuredExplanation() {
  const btn = document.getElementById('ml-suggest');
  if (!btn) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Suggesting…';
  try {
    const r = await withTimeout(API.post('/api/ai/structured-explanation-suggest', {
      avoidPrompts: [state.latexLab?.prompt, document.getElementById('ml-prompt')?.value].filter(Boolean)
    }), 15000, 'Suggestion timed out.');
    const next = normalizeStructuredSuggestion(r);
    state.latexLab = { ...state.latexLab, ...next };
    applyStructuredExplanationSettingsToForm(state.latexLab);
    btn.textContent = '✨ Suggest topic + settings';
    btn.disabled = false;
    return;
  } catch {
    const local = localStructuredSuggestion();
    state.latexLab = { ...state.latexLab, ...local };
    applyStructuredExplanationSettingsToForm(state.latexLab);
    btn.textContent = '✨ Suggest topic + settings';
    btn.disabled = false;
  }

  btn.textContent = old;
  btn.disabled = false;
}

function normalizeStructuredSuggestion(raw = {}) {
  const allowedExample = ['proof', 'worked-example', 'graph-table', 'tree-diagram', 'outline'];
  const allowedComplexity = ['simple', 'standard', 'scholarly'];
  const allowedParagraph = ['brief', 'medium', 'detailed'];
  const allowedDensity = ['text-only', 'mostly-text', 'balanced', 'mostly-visual'];
  const allowedContinuation = ['more-examples', 'different-examples', 'related-topics'];
  return {
    prompt: String(raw.prompt || '').trim() || 'Bayes theorem for medical testing decisions',
    exampleType: allowedExample.includes(raw.exampleType) ? raw.exampleType : 'proof',
    level: LEVELS.includes(raw.level) ? raw.level : 'Upper Intermediate',
    tone: TONES.includes(raw.tone) ? raw.tone : 'Friendly lecture',
    complexity: allowedComplexity.includes(raw.complexity) ? raw.complexity : 'standard',
    paragraphLength: allowedParagraph.includes(raw.paragraphLength) ? raw.paragraphLength : 'medium',
    imageDensity: allowedDensity.includes(raw.imageDensity) ? raw.imageDensity : 'balanced',
    totalSlides: Math.min(20, Math.max(2, parseInt(raw.totalSlides, 10) || 8)),
    continuation: allowedContinuation.includes(raw.continuation) ? raw.continuation : 'related-topics',
    alternateVisualMath: raw.alternateVisualMath !== false
  };
}

function applyStructuredExplanationSettingsToForm(ml = {}) {
  const promptEl = document.getElementById('ml-prompt');
  const exampleTypeEl = document.getElementById('ml-example-type');
  const levelEl = document.getElementById('ml-level');
  const toneEl = document.getElementById('ml-tone');
  const complexityEl = document.getElementById('ml-complexity');
  const slidesEl = document.getElementById('ml-slides');
  const paragraphEl = document.getElementById('ml-paragraph-length');
  const densityEl = document.getElementById('ml-density');
  const continuationEl = document.getElementById('ml-continuation');
  const alternateEl = document.getElementById('ml-alternate');
  if (!promptEl) return;
  promptEl.value = ml.prompt || '';
  if (exampleTypeEl && ml.exampleType) exampleTypeEl.value = ml.exampleType;
  if (levelEl && ml.level) levelEl.value = ml.level;
  if (toneEl && ml.tone) toneEl.value = ml.tone;
  if (complexityEl && ml.complexity) complexityEl.value = ml.complexity;
  if (slidesEl && ml.totalSlides) slidesEl.value = String(Math.min(20, Math.max(2, parseInt(ml.totalSlides, 10) || 8)));
  if (paragraphEl && ml.paragraphLength) paragraphEl.value = ml.paragraphLength;
  if (densityEl && ml.imageDensity) densityEl.value = ml.imageDensity;
  if (continuationEl && ml.continuation) continuationEl.value = ml.continuation;
  if (alternateEl) alternateEl.checked = ml.alternateVisualMath !== false;
}

function localStructuredSuggestion() {
  const candidates = [
    'Bayes theorem for diagnostic testing',
    'Taylor series approximation for sin(x)',
    'Dijkstra shortest-path proof intuition',
    'Supply-demand equilibrium with elasticity table',
    'Decision tree entropy and information gain'
  ];
  const pick = candidates[Math.floor(Math.random() * candidates.length)] || candidates[0];
  const exampleTypePool = ['proof', 'worked-example', 'graph-table', 'tree-diagram', 'outline'];
  const contPool = ['more-examples', 'different-examples', 'related-topics'];
  return {
    prompt: pick,
    exampleType: exampleTypePool[Math.floor(Math.random() * exampleTypePool.length)],
    level: LEVELS[Math.floor(Math.random() * LEVELS.length)] || 'Upper Intermediate',
    tone: TONES[Math.floor(Math.random() * TONES.length)] || 'Friendly lecture',
    complexity: ['simple', 'standard', 'scholarly'][Math.floor(Math.random() * 3)],
    paragraphLength: ['brief', 'medium', 'detailed'][Math.floor(Math.random() * 3)],
    imageDensity: ['mostly-text', 'balanced', 'mostly-visual'][Math.floor(Math.random() * 3)],
    totalSlides: 6 + Math.floor(Math.random() * 6),
    continuation: contPool[Math.floor(Math.random() * contPool.length)],
    alternateVisualMath: Math.random() < 0.8
  };
}

async function refreshSuggestedTopic({ silent = false, forceRefresh = false } = {}) {
  const btn = document.getElementById('refresh-suggested-topic');
  if (btn) {
    btn.disabled = true;
    btn.dataset.oldLabel = btn.textContent;
    btn.textContent = 'Refreshing suggestion…';
  }
  try {
    const r = await withTimeout(API.post('/api/ai/suggested-topic', {
      avoidTopics: [state.topic].filter(Boolean),
      refresh: !!forceRefresh,
      triggerTopic: state.topic || ''
    }), 25000, 'Suggested topic timed out. Please retry.');
    state.homeSuggestion = (r && r.topic)
      ? r
      : {
          error: true,
          why: 'Suggestion service returned an incomplete result. Press refresh to retry.'
        };
    viewHomeWithCurrentTopics();
  } catch (err) {
    state.homeSuggestion = {
      error: true,
      why: 'Could not load suggestion right now. Press refresh suggestion to retry.'
    };
    viewHomeWithCurrentTopics();
    if (!silent) alert(`Could not get suggestion: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.oldLabel || '↻ Refresh suggestion';
    }
  }
}

/* ---------------- learning path ---------------- */
async function loadPath(topic, guidance, levels, opts = {}) {
  state.topic = topic;
  const msg = opts.fromHistory
    ? `Re-recommending concepts based on your play history…`
    : `Asking the AI to sketch a learning path for “${topic}”…`;
  $app.innerHTML = loadingHTML(msg);
  try {
    state.path = await withTimeout(API.post('/api/ai/path', {
      topic, guidance, levels,
      fromHistory: !!opts.fromHistory,
      freshSeed: opts.fresh ? Math.random().toString(36).slice(2, 8) : undefined
    }), 30000, 'Path generation timed out. Please try again.');
    if (!state.path) return;
    viewPath();
  } catch (e) {
    $app.innerHTML = `<div class="card"><p>😖 Could not draw the path: ${esc(e.message)}</p>
      <div class="slide-actions"><button class="btn" onclick="nav('home')">← Back</button>
      <button class="btn primary" id="retry">Try again</button></div></div>`;
    document.getElementById('retry').addEventListener('click', () => loadPath(topic, guidance, levels, opts));
  }
}

function viewPath() {
  const p = state.path;
  if (!p) return viewHome();
  $app.innerHTML = `
    <h1 class="view-title"><span class="scribble-underline">${esc(p.topic || state.topic)}</span> path</h1>
    <p class="view-sub">${esc(p.overview || '')}</p>
    <div class="card alt">
      <b>Not quite right? Redraw it.</b>
      <label class="field" style="margin-top:8px"><span>Tell the AI how to adjust the path (optional)</span>
        <textarea id="path-guidance" rows="2" placeholder="e.g. focus on practical projects, I already know the basics, prepare me for an exam…"></textarea></label>
      <div class="chip-row" style="justify-content:flex-start" id="level-filter">
        ${LEVELS.map(l => `<button class="chip selected" data-level="${esc(l)}">${esc(l)}</button>`).join('')}
      </div>
      <div class="slide-actions" style="justify-content:flex-start; flex-wrap:wrap">
        <button class="btn blue" id="redraw-btn">↻ Redraw path</button>
        <button class="btn green" id="fresh-btn" title="New concept picks based on what you've already studied">🔄 Fresh picks from my history</button>
      </div>
    </div>
    ${(p.levels || []).map(lv => `
      <div class="level-block">
        <div class="level-head">
          <h3>${esc(lv.level)}</h3>
          <button class="btn small" data-refresh-level="${esc(lv.level)}">↻ Refresh ${Math.max(1, (lv.concepts || []).length)} concepts</button>
        </div>
        <p class="level-desc">${esc(lv.description || '')}</p>
        <div class="concept-grid">
          ${(lv.concepts || []).map(c => `
            <button class="concept-card" data-concept="${esc(c.name)}" data-level="${esc(lv.level)}">
              <b>${esc(c.name)}</b>${esc(c.blurb || '')}
            </button>`).join('')}
        </div>
      </div>`).join('')}
    <div class="card">
      <b>Or study your own concept</b>
      <label class="field" style="margin-top:8px"><span>Custom concept</span>
        <input type="text" id="custom-concept" placeholder="e.g. the Krebs cycle, Fourier transforms…" /></label>
      <label class="field"><span>At what level?</span>
        <select id="custom-concept-level">${LEVELS.map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
      <button class="btn primary" id="custom-concept-btn">Study this →</button>
    </div>`;

  document.getElementById('level-filter').querySelectorAll('.chip').forEach(ch =>
    ch.addEventListener('click', () => ch.classList.toggle('selected')));
  document.getElementById('redraw-btn').addEventListener('click', () => {
    const guidance = document.getElementById('path-guidance').value.trim() || undefined;
    const levels = [...document.querySelectorAll('#level-filter .chip.selected')].map(c => c.dataset.level);
    loadPath(state.topic, guidance, levels.length ? levels : undefined);
  });
  document.getElementById('fresh-btn').addEventListener('click', () => {
    const guidance = document.getElementById('path-guidance').value.trim() || undefined;
    const levels = [...document.querySelectorAll('#level-filter .chip.selected')].map(c => c.dataset.level);
    loadPath(state.topic, guidance, levels.length ? levels : undefined, { fromHistory: true, fresh: true });
  });
  $app.querySelectorAll('[data-refresh-level]').forEach(btn => btn.addEventListener('click', async () => {
    const level = btn.dataset.refreshLevel;
    const lv = (state.path.levels || []).find(x => x.level === level);
    if (!lv) return;
    const count = Math.max(1, (lv.concepts || []).length || 5);
    const guidance = document.getElementById('path-guidance').value.trim() || undefined;
    const avoid = (lv.concepts || []).map(c => c.name).filter(Boolean);
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Refreshing…';
    try {
      const refreshed = await withTimeout(API.post('/api/ai/path/level-refresh', {
        topic: state.topic,
        level,
        count,
        avoidConcepts: avoid,
        guidance
      }), 25000, `${level} refresh timed out. Please retry.`);
      state.path.levels = (state.path.levels || []).map(x => x.level === level
        ? {
            ...x,
            description: refreshed.description || x.description,
            concepts: (refreshed.concepts || []).length ? refreshed.concepts : x.concepts
          }
        : x);
      viewPath();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      alert(`Could not refresh ${level}: ${err.message}`);
    }
  }));
  $app.querySelectorAll('.concept-card').forEach(c => c.addEventListener('click', () => {
    state.concept = c.dataset.concept; state.level = c.dataset.level; viewSettings();
  }));
  document.getElementById('custom-concept-btn').addEventListener('click', () => {
    const c = document.getElementById('custom-concept').value.trim();
    if (!c) return;
    state.concept = c;
    state.level = document.getElementById('custom-concept-level').value;
    viewSettings();
  });
}

/* ---------------- activity settings ---------------- */
function viewSettings() {
  if (!state.concept) return viewHome();
  const preset = state.suggestedSettings || null;
  $app.innerHTML = `
    <h1 class="view-title">Set up your <span class="scribble-underline">reading activity</span></h1>
    <p class="view-sub">${esc(state.concept)} · ${esc(state.level)} · ${esc(state.topic)}</p>
    ${state.suggestedGuidance ? `<div class="card alt" style="margin-bottom:12px"><b>Suggested prompt</b><p style="margin-top:6px">${esc(state.suggestedGuidance)}</p><p class="muted-line">You can still customize every setting below.</p></div>` : ''}
    <div class="settings-grid">
      <div class="card">
        <h3>📏 Length</h3>
        <label class="field"><span>How many slides?</span>
          <select id="set-length">
            <option value="4">Short — 4 slides</option>
            <option value="7" selected>Medium — 7 slides</option>
            <option value="10">Long — 10 slides</option>
            <option value="custom">Custom…</option>
          </select></label>
        <label class="field hidden" id="custom-length-wrap"><span>Number of slides (2–20)</span>
          <input type="number" id="set-length-custom" min="2" max="20" value="5" /></label>
        <label class="field"><span>Paragraph length</span>
          <select id="set-paragraph">
            <option value="brief">Brief — a few sentences</option>
            <option value="medium" selected>Medium — a solid paragraph</option>
            <option value="detailed">Detailed — a long paragraph</option>
          </select></label>
        <label class="field"><span>Paragraphs per slide: <b id="para-count-val">3</b></span>
          <input type="range" id="set-paragraph-count" min="1" max="7" value="3" step="1"
            oninput="document.getElementById('para-count-val').textContent=this.value" /></label>
      </div>
      <div class="card alt">
        <h3>🎭 Voice</h3>
        <label class="field"><span>Tone / sentiment</span>
          <select id="set-tone">${TONES.map(t => `<option>${esc(t)}</option>`).join('')}<option value="custom">Custom…</option></select></label>
        <label class="field hidden" id="custom-tone-wrap"><span>Describe the tone</span>
          <input type="text" id="set-tone-custom" placeholder="e.g. like a pirate telling sea stories" /></label>
        <label class="field"><span>Text complexity</span>
          <select id="set-complexity">
            <option value="simple">Simple — plain words, short sentences</option>
            <option value="standard" selected>Standard</option>
            <option value="scholarly">Scholarly — technical vocabulary</option>
          </select></label>
      </div>
      <div class="card">
        <h3>🖼️ Pictures vs. text</h3>
        <label class="field"><span>How visual should slides be?</span>
          <select id="set-density">
            <option value="text-only">No images — text only</option>
            <option value="mostly-text">Mostly text, occasional sketch</option>
            <option value="balanced" selected>Balanced — one sketch per slide</option>
            <option value="mostly-visual">Mostly sketches & graphs, little text</option>
          </select></label>
      </div>
      <div class="card alt">
        <h3>🖋️ Your own rules <small style="font-weight:normal">(optional)</small></h3>
        <label class="field"><span>Language</span>
          <input type="text" id="set-language" placeholder="e.g. English, Español, Français…" /></label>
        <label class="field"><span>Who is this for?</span>
          <input type="text" id="set-audience" placeholder="e.g. a curious 12-year-old, a med student…" /></label>
        <label class="field"><span>Custom instructions for the AI</span>
          <textarea id="set-instructions" rows="3" placeholder="e.g. use soccer analogies, add historical anecdotes, avoid formulas…"></textarea></label>
      </div>
    </div>
    <div class="slide-actions" style="justify-content:center;margin-top:24px">
      <button class="btn" onclick="nav('path')">← Back to path</button>
      <button class="btn primary" id="start-btn" style="font-size:1.3rem">Start learning ✏️</button>
    </div>`;

  document.getElementById('set-length').addEventListener('change', e =>
    document.getElementById('custom-length-wrap').classList.toggle('hidden', e.target.value !== 'custom'));
  document.getElementById('set-tone').addEventListener('change', e =>
    document.getElementById('custom-tone-wrap').classList.toggle('hidden', e.target.value !== 'custom'));

  if (preset) {
    const len = Math.min(20, Math.max(2, parseInt(preset.totalSlides, 10) || 7));
    const lenSelect = document.getElementById('set-length');
    if ([4, 7, 10].includes(len)) {
      lenSelect.value = String(len);
      document.getElementById('custom-length-wrap').classList.add('hidden');
    } else {
      lenSelect.value = 'custom';
      document.getElementById('custom-length-wrap').classList.remove('hidden');
      document.getElementById('set-length-custom').value = String(len);
    }

    if (preset.paragraphLength) document.getElementById('set-paragraph').value = preset.paragraphLength;
    const paraCount = Math.min(7, Math.max(1, parseInt(preset.paragraphCount, 10) || 3));
    document.getElementById('set-paragraph-count').value = String(paraCount);
    document.getElementById('para-count-val').textContent = String(paraCount);
    if (preset.complexity) document.getElementById('set-complexity').value = preset.complexity;
    if (preset.imageDensity) document.getElementById('set-density').value = preset.imageDensity;
    if (preset.language) document.getElementById('set-language').value = preset.language;
    if (preset.audience) document.getElementById('set-audience').value = preset.audience;
    if (preset.customInstructions) document.getElementById('set-instructions').value = preset.customInstructions;

    if (preset.tone && TONES.includes(preset.tone)) {
      document.getElementById('set-tone').value = preset.tone;
      document.getElementById('custom-tone-wrap').classList.add('hidden');
    } else if (preset.tone) {
      document.getElementById('set-tone').value = 'custom';
      document.getElementById('custom-tone-wrap').classList.remove('hidden');
      document.getElementById('set-tone-custom').value = preset.tone;
    }
  }

  document.getElementById('start-btn').addEventListener('click', () => {
    const lenSel = document.getElementById('set-length').value;
    const totalSlides = lenSel === 'custom'
      ? Math.min(20, Math.max(2, parseInt(document.getElementById('set-length-custom').value, 10) || 5))
      : parseInt(lenSel, 10);
    const toneSel = document.getElementById('set-tone').value;
    const tone = toneSel === 'custom'
      ? (document.getElementById('set-tone-custom').value.trim() || 'friendly lecture') : toneSel;
    state.settings = {
      totalSlides,
      tone,
      activityType: state.suggestedSettings?.activityType || (state.latexLab?.exampleType ? 'structured-explanation' : ''),
      exampleType: state.suggestedSettings?.exampleType || state.latexLab?.exampleType || '',
      complexity: document.getElementById('set-complexity').value,
      paragraphLength: document.getElementById('set-paragraph').value,
      paragraphCount: parseInt(document.getElementById('set-paragraph-count').value, 10) || 3,
      imageDensity: document.getElementById('set-density').value,
      language: document.getElementById('set-language').value.trim(),
      audience: document.getElementById('set-audience').value.trim(),
      customInstructions: document.getElementById('set-instructions').value.trim()
    };
    startGame();
  });
}

/* ---------------- the adaptive slide game ---------------- */
/* ---------------- browser memory: cache prefetched branch slides in sessionStorage ----------------
   Every option's next slide is generated in the background (the "loads"); the branches the
   learner does not pick are dumped. sessionStorage keeps the resolved slides so re-picking or a
   mid-lesson reload reuses them instead of regenerating, and clears when the game ends. */
const SLIDE_MEM_PREFIX = 'sketch:slide:';

function slideMemKey(gameId, slideNumber, branchText) {
  return `${SLIDE_MEM_PREFIX}${gameId}:${slideNumber}:${hashText(branchText || 'root')}`;
}
function pruneSlideMem() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SLIDE_MEM_PREFIX)) keys.push(k);
    }
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => sessionStorage.removeItem(k));
  } catch { /* sessionStorage unavailable */ }
}
function memGetSlide(gameId, slideNumber, branchText) {
  try {
    const v = sessionStorage.getItem(slideMemKey(gameId, slideNumber, branchText));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function memPutSlide(gameId, slideNumber, branchText, slide) {
  if (!slide) return;
  const write = () => sessionStorage.setItem(slideMemKey(gameId, slideNumber, branchText), JSON.stringify(slide));
  try { write(); }
  catch { pruneSlideMem(); try { write(); } catch { /* over quota, skip cache */ } }
}
function clearSlideMem(gameId) {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (!gameId || k.startsWith(`${SLIDE_MEM_PREFIX}${gameId}:`))) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch { /* sessionStorage unavailable */ }
}

async function startGame() {
  clearSlideMem(); // fresh session memory for a new presentation
  state.game = {
    id: crypto.randomUUID(),
    topic: state.topic, concept: state.concept, level: state.level,
    settings: state.settings,
    slideNumber: 1,
    history: [],        // compressed memory sent to the AI
    answers: [],        // full per-slide record for stats
    prefetch: null,     // option index -> promise of the next slide
    startTime: Date.now(),
    finished: false
  };
  $app.innerHTML = loadingHTML('The AI is sketching slide 1…');
  try {
    const slide = await requestSlide(null);
    showSlide(slide);
  } catch (e) { gameError(e, () => startGame()); }
}

function requestSlide(branch, slideNumber) {
  const g = state.game;
  return API.post('/api/ai/slide', {
    gameId: g.id, topic: g.topic, concept: g.concept, level: g.level,
    settings: g.settings,
    slideNumber: slideNumber || g.slideNumber,
    totalSlides: g.settings.totalSlides,
    history: branch ? [...g.history, branch.historyEntry] : g.history,
    branch: branch ? { chosenText: branch.chosenText, correct: branch.correct, misconception: branch.misconception } : null
  });
}

function gameError(e, retry) {
  $app.innerHTML = `<div class="card"><p>😖 The AI pencil broke: ${esc(e.message)}</p>
    <div class="slide-actions"><button class="btn" id="ge-home">Quit</button>
    <button class="btn primary" id="ge-retry">Try again</button></div></div>`;
  document.getElementById('ge-home').addEventListener('click', () => { state.game = null; viewHome(); });
  document.getElementById('ge-retry').addEventListener('click', retry);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function inferEraHint(text) {
  const t = String(text || '').toLowerCase();
  if (/future|futur|2050|2060|2070|2080|2090|2100|tomorrow|next decade|next century/.test(t)) return 'future';
  if (/past|ancient|medieval|renaissance|victorian|historical|century ago|1800|1900|retro|old city/.test(t)) return 'past';
  return 'present';
}

function escXmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hashText(s) {
  let h = 0;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildTimeTravelImageDataUrl(slide, game) {
  const context = [
    game?.topic,
    game?.concept,
    game?.settings?.customInstructions,
    slide?.title,
    slide?.summary,
    slide?.quiz?.question
  ].filter(Boolean).join(' ');
  const era = inferEraHint(context);
  const palette = era === 'future'
    ? { bg: '#e8f3ff', accent: '#5c80bc', ink: '#17324d' }
    : era === 'past'
      ? { bg: '#f7efe1', accent: '#a36a2c', ink: '#3b2611' }
      : { bg: '#edf6ef', accent: '#3f8a58', ink: '#173223' };
  const title = escXmlText(String(slide?.title || game?.concept || 'Time Travel concept').slice(0, 74));
  const promptLine = escXmlText(String(slide?.quiz?.question || '').slice(0, 120));
  const slideNo = Number(game?.slideNumber || 1);
  const seed = hashText(`${context}|${slideNo}`);
  const h1 = 130 + (seed % 180);
  const h2 = 160 + ((seed >> 3) % 220);
  const h3 = 140 + ((seed >> 5) % 200);
  const c1 = 700 - ((seed >> 2) % 100);
  const c2 = 690 - ((seed >> 4) % 100);
    const variant = seed % 3;
    const scene = variant === 0
     ? `<circle cx="180" cy="390" r="42" fill="${palette.accent}" opacity="0.35"/>
       <circle cx="270" cy="360" r="26" fill="${palette.accent}" opacity="0.2"/>
       <path d="M120 830 L260 690 L380 830" />`
     : variant === 1
      ? `<path d="M120 380 L420 300 L760 430" />
        <path d="M120 430 L420 350 L760 480" opacity="0.7"/>
        <rect x="760" y="300" width="110" height="80" rx="10" fill="${palette.accent}" opacity="0.25"/>`
      : `<rect x="120" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>
        <rect x="235" y="360" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.2"/>
        <rect x="350" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>`;
  const eraLabel = era.toUpperCase();
  const nanoLabel = 'NANO BANANA STYLE';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect x="56" y="56" width="912" height="912" rx="28" fill="none" stroke="${palette.accent}" stroke-width="10"/>
  <text x="84" y="118" font-family="Georgia, serif" font-size="38" fill="${palette.ink}">${nanoLabel}</text>
  <text x="84" y="168" font-family="Georgia, serif" font-size="36" fill="${palette.ink}">${eraLabel} SCENE - SLIDE ${slideNo}</text>
  <text x="84" y="226" font-family="Georgia, serif" font-size="32" fill="${palette.ink}">${title}</text>
  <text x="84" y="278" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${promptLine}</text>
  <g stroke="${palette.ink}" stroke-width="7" fill="none" opacity="0.85">${scene}</g>
  <g stroke="${palette.ink}" stroke-width="8" fill="none" opacity="0.9">
    <path d="M110 ${c1} C 250 ${c1 - 120}, 380 ${c1 - 110}, 520 ${c1}"/>
    <path d="M500 ${c2} C 640 ${c2 - 120}, 760 ${c2 - 110}, 900 ${c2}"/>
    <rect x="180" y="${860 - h1}" width="170" height="${h1}" rx="8" fill="${palette.accent}" opacity="0.2"/>
    <rect x="390" y="${860 - h2}" width="220" height="${h2}" rx="8" fill="${palette.accent}" opacity="0.16"/>
    <rect x="660" y="${860 - h3}" width="170" height="${h3}" rx="8" fill="${palette.accent}" opacity="0.2"/>
  </g>
</svg>`;
  return { era, url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

function enforceGraphOnlyClient(slide, game) {
  if (game?.settings?.imageDensity !== 'text-only') return slide;
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  slide.components = comps.filter(c => !['svg', 'image', 'latex', 'code', 'table'].includes(c?.type));
  return slide;
}

function showSlide(slide) {
  const g = state.game;
  window.scrollTo(0, 0); // start each slide at the top so the user reads top-to-bottom
  slide = enforceGraphOnlyClient(slide, g);
  // shuffle option order so the correct answer isn't always in the same slot;
  // done once here, before both rendering and prefetch, so indices stay aligned
  if (slide.quiz && Array.isArray(slide.quiz.options)) shuffleInPlace(slide.quiz.options);
  g.current = slide;
  const total = g.settings.totalSlides;
  const pct = Math.round(100 * (g.slideNumber - 1) / total);

  $app.innerHTML = `
    <div class="slide-shell">
      <div class="progress-row">
        <span>Slide ${g.slideNumber}/${total}</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span id="game-timer">0:00</span>
      </div>
      <div class="slide">
        <h2>${esc(slide.title)}</h2>
        ${renderComponents(slide.components)}
        <div class="quiz-box">
          <p class="quiz-q">🤔 ${esc(slide.quiz.question)}</p>
          <div class="quiz-options">
            ${slide.quiz.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${'ABCD'[i] || '•'})&nbsp; ${esc(o.text)}</button>`).join('')}
          </div>
          <div id="quiz-feedback"></div>
        </div>
        <div class="slide-actions" id="slide-actions"></div>
      </div>
    </div>`;

  startTimerDisplay();

  // ---- prefetch: generate the next slide for EVERY option now, in the background,
  // so the moment the learner picks one it is already loaded (no wait, no spinner) ----
  g.prefetch = null;
  g.prefetchReady = {}; // idx -> resolved slide, for instant display without a loading flash
  if (g.slideNumber < g.settings.totalSlides) {
    g.prefetch = slide.quiz.options.map((o, i) => {
      const branch = branchFor(slide, o);
      const cached = memGetSlide(g.id, g.slideNumber + 1, branch.chosenText);
      const promise = cached ? Promise.resolve(cached) : requestSlide(branch, g.slideNumber + 1);
      // remember resolved value + store in browser memory so re-picks/reloads reuse it
      promise.then(s => { g.prefetchReady[i] = s; memPutSlide(g.id, g.slideNumber + 1, branch.chosenText, s); }).catch(() => { });
      return promise;
    });
  }

  $app.querySelectorAll('.quiz-opt').forEach(btn =>
    btn.addEventListener('click', () => answer(parseInt(btn.dataset.i, 10))));
}

function summarizeSlideVisuals(slide) {
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  const toText = (v) => String(v || '').trim();
  return comps
    .filter(c => ['table', 'svg', 'image', 'latex', 'code'].includes(c?.type))
    .map((c) => {
      if (c.type === 'table') {
        const headers = Array.isArray(c.headers) ? c.headers.join(' | ') : '';
        const firstRow = Array.isArray(c.rows) && c.rows[0] ? c.rows[0].join(' | ') : '';
        const secondRow = Array.isArray(c.rows) && c.rows[1] ? c.rows[1].join(' | ') : '';
        return `table:${toText(c.caption)}::${toText(headers)}::${toText(firstRow)}::${toText(secondRow)}`.slice(0, 220);
      }
      if (c.type === 'svg') return `svg:${toText(c.caption)}::${toText(String(c.svg || '').replace(/\s+/g, ' ').slice(0, 120))}`.slice(0, 220);
      if (c.type === 'image') {
        const urlHead = toText(String(c.url || '').slice(0, 180));
        return `image:${toText(c.caption || c.prompt || c.alt)}::${toText(c.prompt || '')}::${urlHead}`.slice(0, 300);
      }
      if (c.type === 'latex') return `latex:${toText(c.caption || '')}::${toText(c.content || '')}`.slice(0, 220);
      if (c.type === 'code') return `code:${toText(c.language)}:${toText(c.content).split('\n')[0]}`.slice(0, 180);
      return '';
    })
    .filter(Boolean);
}

function branchFor(slide, option) {
  const visualRefs = summarizeSlideVisuals(slide);
  return {
    chosenText: option.text,
    correct: !!option.correct,
    misconception: option.misconception || '',
    historyEntry: {
      title: slide.title, summary: slide.summary,
      question: slide.quiz.question, chosen: option.text, correct: !!option.correct,
      visualRefs
    }
  };
}

function answer(idx) {
  const g = state.game;
  const slide = g.current;
  const opt = slide.quiz.options[idx];
  const correctIdx = slide.quiz.options.findIndex(o => o.correct);

  $app.querySelectorAll('.quiz-opt').forEach((b, i) => {
    b.disabled = true;
    if (i === idx) b.classList.add(opt.correct ? 'picked-correct' : 'picked-wrong');
    else if (i === correctIdx && !opt.correct) b.classList.add('reveal-correct');
  });

  document.getElementById('quiz-feedback').innerHTML = opt.correct
    ? `<div class="quiz-feedback good"><b>✔ Correct!</b> ${esc(opt.explanation || '')}${g.slideNumber < g.settings.totalSlides ? ' The next slide digs deeper.' : ''}</div>`
    : `<div class="quiz-feedback bad"><b>✘ Not quite.</b> ${esc(opt.explanation || '')}${g.slideNumber < g.settings.totalSlides ? ' The next slide takes a detour to fix this idea.' : ''}</div>`;

  const branch = branchFor(slide, opt);
  g.answers.push({
    slide: g.slideNumber, title: slide.title, question: slide.quiz.question,
    chosen: opt.text, correct: !!opt.correct, misconception: opt.misconception || ''
  });
  g.history.push(branch.historyEntry);

  const actions = document.getElementById('slide-actions');
  if (g.slideNumber >= g.settings.totalSlides) {
    actions.innerHTML = `<button class="btn primary" id="next-btn">See my results 🏁</button>`;
    document.getElementById('next-btn').addEventListener('click', finishGame);
  } else {
    actions.innerHTML = `<button class="btn primary" id="next-btn">Next slide →</button>`;
    document.getElementById('next-btn').addEventListener('click', () => advance(idx, branch));
  }
}

async function advance(idx, branch) {
  const g = state.game;
  try {
    // If this branch's slide already finished loading in the background, show it
    // instantly with no spinner; otherwise show the loader only while we wait.
    let slide = (g.prefetchReady && g.prefetchReady[idx]) || null;
    if (!slide) {
      window.scrollTo(0, 0);
      $app.innerHTML = loadingHTML('Turning the page…');
      try {
        slide = await g.prefetch[idx];
      } catch {
        slide = memGetSlide(g.id, g.slideNumber + 1, branch.chosenText)
          || await requestSlide(branch, g.slideNumber + 1);
      }
    }
    memPutSlide(g.id, g.slideNumber + 1, branch.chosenText, slide);
    g.slideNumber++;
    showSlide(slide); // scrolls to top itself
  } catch (e) { gameError(e, () => advance(idx, branch)); }
}

let timerInterval = null;
function startTimerDisplay() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const el = document.getElementById('game-timer');
    if (!el || !state.game) { clearInterval(timerInterval); return; }
    const s = Math.floor((Date.now() - state.game.startTime) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

/* ---------------- final stats slide ---------------- */
async function finishGame() {
  const g = state.game;
  g.finished = true;
  clearInterval(timerInterval);
  clearSlideMem(g.id); // presentation done → dump its cached branch slides
  const durationSec = Math.floor((Date.now() - g.startTime) / 1000);
  const correct = g.answers.filter(a => a.correct).length;
  const total = g.answers.length;
  const questionSummary = g.answers.map(a => a.question).filter(Boolean).join(', ');
  const answerSummary = g.answers.map(a => a.chosen).filter(Boolean).join(', ');

  $app.innerHTML = loadingHTML('Grading your sketchbook…');

  let rec = null;
  let gradingNote = '';
  try {
    rec = await withTimeout(API.post('/api/ai/recommend', {
      topic: g.topic, concept: g.concept, level: g.level,
      correct, total, durationSec, slides: g.answers
    }), 12000, 'Coach grading took too long. Showing report without coach notes.');
  } catch (e) {
    gradingNote = `<p class="form-error">${esc(e.message || 'Coach grading was unavailable. Showing report without coach notes.')}</p>`;
  }

  let saveNote = '';
  let saved = null;
  try {
    saved = await withTimeout(API.post('/api/games', {
      topic: g.topic, concept: g.concept, level: g.level, settings: g.settings,
      slides: g.answers, correct, total, durationSec, recommendations: rec,
      questionSummary,
      answerSummary,
      aiNotes: rec?.aiNotes || []
    }), 12000, 'Saving took too long. Report is visible, but this run may not be in history yet.');
  } catch (e) { saveNote = `<p class="form-error">Could not save this run: ${esc(e.message)}</p>`; }

  const mins = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`;
  const shareUrl = saved?.shareUrl || '';
  $app.innerHTML = `
    <div class="slide-shell">
      <div class="slide">
        <h2>🏁 ${esc(g.concept)} — your results</h2>
        <p><b>${esc(API.user.username)}</b> · ${esc(g.level)} · ${esc(g.topic)}</p>
        <p class="muted-line">Completed on ${esc(new Date().toLocaleDateString())} at ${esc(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</p>
        <div class="stat-row">
          <div class="stat-tile"><div class="big">${correct}/${total}</div>correct</div>
          <div class="stat-tile"><div class="big">${total ? Math.round(100 * correct / total) : 0}%</div>score</div>
          <div class="stat-tile"><div class="big">${mins}</div>time</div>
        </div>
        ${shareUrl ? `<div class="share-box"><div><b>Shareable report</b><br><a href="${esc(shareUrl)}" target="_blank" rel="noreferrer">${esc(shareUrl)}</a></div><button class="btn small" id="copy-share">Copy link</button></div>` : ''}
        ${Array.isArray(rec?.aiNotes) && rec.aiNotes.length ? `<div class="quiz-feedback" style="margin-top:14px"><b>AI notes</b><ul style="padding-left:22px;margin-top:6px">${rec.aiNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <div class="table-wrap"><table class="sketch">
          <tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th><th>AI notes</th></tr>
          ${g.answers.map(a => `<tr><td>${a.slide}</td><td>${esc(a.question)}</td><td>${esc(a.chosen)}</td><td>${a.correct ? '✔' : '✘'}</td><td class="clamped">${esc(Array.isArray(rec?.aiNotes) ? rec.aiNotes.join(' · ') : '')}</td></tr>`).join('')}
        </table></div>
        ${rec ? `
          <div class="quiz-feedback" style="margin-top:18px">
            <p><b>Coach says:</b> ${esc(rec.summary || '')}</p>
            <ul style="padding-left:22px;margin-top:6px">${(rec.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            ${(rec.nextConcepts || []).length ? `<p style="margin-top:6px"><b>Try next:</b> ${rec.nextConcepts.map(n => `${esc(n.name)} (${esc(n.level)})`).join(' · ')}</p>` : ''}
          </div>` : ''}
        ${gradingNote}
        ${saveNote}
        <div class="slide-actions">
          <button class="btn" id="fin-stats">My stats</button>
          <button class="btn blue" id="fin-again">Same concept again</button>
          <button class="btn primary" id="fin-new">New topic</button>
        </div>
      </div>
    </div>`;
  state.game = null;
  document.getElementById('fin-stats').addEventListener('click', () => nav('stats'));
  document.getElementById('fin-again').addEventListener('click', () => viewSettings());
  document.getElementById('fin-new').addEventListener('click', () => nav('home'));
}

/* ---------------- my stats ---------------- */
async function viewStats() {
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

async function downloadCsv() {
  const res = await fetch('/api/games/export.csv', { headers: { Authorization: `Bearer ${API.token}` } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sketchlearn-progress.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- coach chat ---------------- */
function viewChat() {
  $app.innerHTML = `
    <h1 class="view-title">Coach <span class="scribble-underline">chat</span></h1>
    <p class="view-sub">The coach reads your progress spreadsheet and guides your next steps.
      <button class="btn small" id="chat-export">⬇ spreadsheet</button></p>
    <div class="chat-shell">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="Ask what to study next, or how the site works…"></textarea>
        <button class="btn primary" id="chat-send">Send</button>
      </div>
      <div class="slide-actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn small ghost" id="chat-clear">Clear chat</button>
      </div>
    </div>`;
  document.getElementById('chat-export').addEventListener('click', downloadCsv);
  document.getElementById('chat-clear').addEventListener('click', () => {
    if (!confirm('Clear the chat window?')) return;
    state.chat = [{ role: 'assistant', content: "Hi! I'm your SketchLearn coach. I can see your progress spreadsheet and help you pick what to study next, or explain how to use the site. What are you curious about?" }];
    renderChatLog();
  });
  renderChatLog();
  const send = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    state.chat.push({ role: 'user', content: text });
    renderChatLog(true);
    try {
      const r = await API.post('/api/ai/chat', { messages: state.chat.filter(m => m.role !== 'pending') });
      state.chat.push({ role: 'assistant', content: r.reply });
    } catch (e) {
      state.chat.push({ role: 'assistant', content: `(The coach dropped their pencil: ${e.message})` });
    }
    renderChatLog();
  };
  document.getElementById('chat-send').addEventListener('click', send);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function renderChatLog(thinking) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  log.innerHTML = state.chat.map(m =>
    `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}</div>`).join('') +
    (thinking ? `<div class="msg ai">✏️ …</div>` : '');
  log.scrollTop = log.scrollHeight;
}

/* ---------------- admin dashboard ---------------- */
async function viewDashboard() {
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

boot();
