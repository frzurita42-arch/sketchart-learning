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
    <div class="slide-actions" style="justify-content:center;margin-bottom:10px">
      <button class="btn small blue" id="refresh-home-topics">↻ Refresh 12 topic ideas</button>
    </div>
    <div class="chip-row">${state.homeTopics.map(t => `<button class="chip" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="card alt" style="max-width:560px;margin:26px auto 0">
      <label class="field"><span>…or a custom topic</span>
        <input type="text" id="custom-topic" placeholder="e.g. Renaissance art, Rust programming, beekeeping…" /></label>
      <button class="btn primary" id="custom-topic-btn">Draw my path →</button>
    </div>`;

  document.getElementById('refresh-home-topics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Refreshing ideas…';
    try {
      const r = await withTimeout(API.post('/api/ai/topics', {
        count: 12,
        avoid: state.homeTopics
      }), 25000, 'Topic refresh timed out. Please retry.');
      if (!r || !Array.isArray(r.topics)) return;
      const fromAI = r.topics.map(t => t.name).filter(Boolean);
      if (fromAI.length) state.homeTopics = shuffled(fromAI).slice(0, 12);
      viewHomeWithCurrentTopics();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = oldLabel;
      alert(`Could not refresh topics: ${err.message}`);
    }
  });

  bindHomeTopicHandlers();
}

function viewHomeWithCurrentTopics() {
  $app.innerHTML = `
    <h1 class="view-title">What do you want to <span class="scribble-underline">learn</span> today?</h1>
    <p class="view-sub">Pick a subject, or write your own.</p>
    <div class="slide-actions" style="justify-content:center;margin-bottom:10px">
      <button class="btn small blue" id="refresh-home-topics">↻ Refresh 12 topic ideas</button>
    </div>
    <div class="chip-row">${shuffled(state.homeTopics).map(t => `<button class="chip" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="card alt" style="max-width:560px;margin:26px auto 0">
      <label class="field"><span>…or a custom topic</span>
        <input type="text" id="custom-topic" placeholder="e.g. Renaissance art, Rust programming, beekeeping…" /></label>
      <button class="btn primary" id="custom-topic-btn">Draw my path →</button>
    </div>`;

  document.getElementById('refresh-home-topics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Refreshing ideas…';
    try {
      const r = await withTimeout(API.post('/api/ai/topics', {
        count: 12,
        avoid: state.homeTopics
      }), 25000, 'Topic refresh timed out. Please retry.');
      if (!r || !Array.isArray(r.topics)) return;
      const fromAI = r.topics.map(t => t.name).filter(Boolean);
      if (fromAI.length) state.homeTopics = shuffled(fromAI).slice(0, 12);
      viewHomeWithCurrentTopics();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = oldLabel;
      alert(`Could not refresh topics: ${err.message}`);
    }
  });

  bindHomeTopicHandlers();
}

function bindHomeTopicHandlers() {
  $app.querySelectorAll('[data-topic]').forEach(b => b.addEventListener('click', () => loadPath(b.dataset.topic)));
  const custom = () => {
    const t = document.getElementById('custom-topic').value.trim();
    if (t) loadPath(t);
  };
  document.getElementById('custom-topic-btn').addEventListener('click', custom);
  document.getElementById('custom-topic').addEventListener('keydown', e => { if (e.key === 'Enter') custom(); });
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
  $app.innerHTML = `
    <h1 class="view-title">Set up your <span class="scribble-underline">reading activity</span></h1>
    <p class="view-sub">${esc(state.concept)} · ${esc(state.level)} · ${esc(state.topic)}</p>
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
async function startGame() {
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

function showSlide(slide) {
  const g = state.game;
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

  // ---- prefetch: generate the next slide for EVERY option now, so it's
  // already loaded the moment the learner picks one ----
  g.prefetch = null;
  if (g.slideNumber < g.settings.totalSlides) {
    g.prefetch = slide.quiz.options.map((o) => {
      const branch = branchFor(slide, o);
      const promise = requestSlide(branch, g.slideNumber + 1);
      promise.catch(() => { }); // avoid unhandled rejection; retried on demand
      return promise;
    });
  }

  $app.querySelectorAll('.quiz-opt').forEach(btn =>
    btn.addEventListener('click', () => answer(parseInt(btn.dataset.i, 10))));
}

function branchFor(slide, option) {
  return {
    chosenText: option.text,
    correct: !!option.correct,
    misconception: option.misconception || '',
    historyEntry: {
      title: slide.title, summary: slide.summary,
      question: slide.quiz.question, chosen: option.text, correct: !!option.correct
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
  $app.innerHTML = loadingHTML('Turning the page…');
  try {
    let slide;
    try {
      slide = await g.prefetch[idx]; // usually already resolved
    } catch {
      slide = await requestSlide(branch, g.slideNumber + 1); // prefetch failed → retry live
    }
    g.slideNumber++;
    showSlide(slide);
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
  const durationSec = Math.floor((Date.now() - g.startTime) / 1000);
  const correct = g.answers.filter(a => a.correct).length;
  const total = g.answers.length;

  $app.innerHTML = loadingHTML('Grading your sketchbook…');

  let rec = null;
  try {
    rec = await API.post('/api/ai/recommend', {
      topic: g.topic, concept: g.concept, level: g.level,
      correct, total, durationSec, slides: g.answers
    });
  } catch { /* recommendations are a bonus; stats still shown */ }

  let saveNote = '';
  try {
    await API.post('/api/games', {
      topic: g.topic, concept: g.concept, level: g.level, settings: g.settings,
      slides: g.answers, correct, total, durationSec, recommendations: rec
    });
  } catch (e) { saveNote = `<p class="form-error">Could not save this run: ${esc(e.message)}</p>`; }

  const mins = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`;
  $app.innerHTML = `
    <div class="slide-shell">
      <div class="slide">
        <h2>🏁 ${esc(g.concept)} — your results</h2>
        <p><b>${esc(API.user.username)}</b> · ${esc(g.level)} · ${esc(g.topic)}</p>
        <div class="stat-row">
          <div class="stat-tile"><div class="big">${correct}/${total}</div>correct</div>
          <div class="stat-tile"><div class="big">${total ? Math.round(100 * correct / total) : 0}%</div>score</div>
          <div class="stat-tile"><div class="big">${mins}</div>time</div>
        </div>
        <div class="table-wrap"><table class="sketch">
          <tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th></tr>
          ${g.answers.map(a => `<tr><td>${a.slide}</td><td>${esc(a.question)}</td><td>${esc(a.chosen)}</td><td>${a.correct ? '✔' : '✘'}</td></tr>`).join('')}
        </table></div>
        ${rec ? `
          <div class="quiz-feedback" style="margin-top:18px">
            <p><b>Coach says:</b> ${esc(rec.summary || '')}</p>
            <ul style="padding-left:22px;margin-top:6px">${(rec.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            ${(rec.nextConcepts || []).length ? `<p style="margin-top:6px"><b>Try next:</b> ${rec.nextConcepts.map(n => `${esc(n.name)} (${esc(n.level)})`).join(' · ')}</p>` : ''}
          </div>` : ''}
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
  $app.innerHTML = `
    <h1 class="view-title">My <span class="scribble-underline">stats</span></h1>
    <div class="stat-row">
      <div class="stat-tile"><div class="big">${mine.length}</div>activities</div>
      <div class="stat-tile"><div class="big">${totalQ ? Math.round(100 * totalCorrect / totalQ) : 0}%</div>avg score</div>
      <div class="stat-tile"><div class="big">${Math.round(totalTime / 60)}m</div>time learning</div>
    </div>
    <div class="card">
      <div class="table-wrap"><table class="sketch">
        <tr><th>Date</th><th>Topic</th><th>Concept</th><th>Level</th><th>Score</th><th>Time</th></tr>
        ${mine.slice().reverse().map(g => `<tr>
          <td>${new Date(g.finishedAt).toLocaleDateString()}</td><td>${esc(g.topic)}</td><td>${esc(g.concept)}</td>
          <td>${esc(g.level)}</td><td>${g.correct}/${g.total}</td><td>${Math.floor(g.durationSec / 60)}:${String(g.durationSec % 60).padStart(2, '0')}</td>
        </tr>`).join('') || '<tr><td colspan="6">Nothing yet — go learn something!</td></tr>'}
      </table></div>
      <div class="slide-actions" style="justify-content:flex-start">
        <button class="btn small" id="export-csv">⬇ Download progress spreadsheet (CSV)</button>
        <button class="btn small ghost" id="change-pass">Change my password</button>
      </div>
    </div>`;
  document.getElementById('export-csv').addEventListener('click', downloadCsv);
  document.getElementById('change-pass').addEventListener('click', async () => {
    const p = prompt('New password:');
    if (!p) return;
    try { await API.post(`/api/users/${encodeURIComponent(API.user.username)}/password`, { password: p }); alert('Password changed!'); }
    catch (e) { alert(e.message); }
  });
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
    </div>`;
  document.getElementById('chat-export').addEventListener('click', downloadCsv);
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
