/* Structured Explanations activity: a formula/concept turned into step-by-step
 * proof / worked-example slides, with an AI "suggest topic + settings" helper. */
import { API } from '../core/api.js';
import { state, LEVELS, TONES } from '../core/state.js';
import { withTimeout } from '../core/util.js';
import { esc } from '../ui/index.js';
import { renderInstructionPlank, triggerHomePreloads } from '../views/home.js';
import { loadPath } from '../flows/path.js';

export function renderStructuredExplanationsSection() {
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

export function bindStructured() {
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
