/* Suggested Topic activity: a history-grounded topic pick with a "use it" button. */
import { API } from '../core/api.js';
import { state } from '../core/state.js';
import { withTimeout } from '../core/util.js';
import { esc } from '../ui/index.js';
import { renderInstructionPlank, viewHomeWithCurrentTopics } from '../views/home.js';
import { loadPath } from '../flows/path.js';

export function renderSuggestedTopicSection() {
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

export function bindSuggested() {
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
}

export async function refreshSuggestedTopic({ silent = false, forceRefresh = false } = {}) {
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
