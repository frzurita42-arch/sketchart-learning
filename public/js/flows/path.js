/* Learning-path flow: fetch/redraw the path, then the per-activity settings form. */
import { API } from '../core/api.js';
import { state, $app, LEVELS, TONES } from '../core/state.js';
import { withTimeout } from '../core/util.js';
import { esc, loadingHTML } from '../ui/index.js';
import { viewHome } from '../views/home.js';
import { startGame } from '../game/engine.js';

/* ---------------- learning path ---------------- */
export async function loadPath(topic, guidance, levels, opts = {}) {
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

export function viewPath() {
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
export function viewSettings() {
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
