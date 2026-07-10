/* Time Travel activity: turn an era + headline into a playable news-story lesson. */
import { API } from '../core/api.js';
import { state, LEVELS } from '../core/state.js';
import { withTimeout } from '../core/util.js';
import { esc } from '../ui/index.js';
import { renderInstructionPlank, triggerHomePreloads } from '../views/home.js';
import { loadPath } from '../flows/path.js';

export function renderTimeTravelActivitySection() {
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

export function bindTimeTravel() {
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
