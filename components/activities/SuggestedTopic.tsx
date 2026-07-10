'use client';
/* Suggested Topic activity: a history-grounded topic pick with a "use it" button.
 * Ported from public/js/activities/suggested-topic.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { appState } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { loadPath, type FlowApp } from '@/lib/flows';
import { InstructionPlank } from './InstructionPlank';

export async function refreshSuggestedTopic(app: FlowApp, { silent = false, forceRefresh = false }: any = {}) {
  try {
    const r = await withTimeout(API.post('/api/ai/suggested-topic', {
      avoidTopics: [appState.topic].filter(Boolean),
      refresh: !!forceRefresh,
      triggerTopic: appState.topic || '',
    }), 25000, 'Suggested topic timed out. Please retry.');
    appState.homeSuggestion = (r && r.topic)
      ? r
      : { error: true, why: 'Suggestion service returned an incomplete result. Press refresh to retry.' };
    app.rerender();
  } catch (err: any) {
    appState.homeSuggestion = { error: true, why: 'Could not load suggestion right now. Press refresh suggestion to retry.' };
    app.rerender();
    if (!silent) alert(`Could not get suggestion: ${err.message}`);
  }
}

export function SuggestedTopic() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const s = appState.homeSuggestion;
  const settings = s?.settings || {};
  const hasSuggestion = !!(s && s.topic && !s.error);
  const setupReceipt = [
    `Level: ${settings.level || 'Upper Intermediate'}`,
    `Slides: ${String(settings.totalSlides || 7)}`,
    `Paragraph: ${settings.paragraphLength || 'medium'}`,
    `Para/slide: ${String(settings.paragraphCount || 3)}`,
    `Tone: ${settings.tone || 'Friendly lecture'}`,
    `Complexity: ${settings.complexity || 'standard'}`,
    `Visual: ${settings.imageDensity || 'balanced'}`,
  ].join(' | ');

  const refresh = async () => {
    setBusy(true);
    await refreshSuggestedTopic(app, { silent: false, forceRefresh: true });
    setBusy(false);
  };

  const use = () => {
    if (!s || !s.topic) return;
    appState.suggestedSettings = {
      totalSlides: parseInt(s.settings?.totalSlides, 10) || 7,
      tone: s.settings?.tone || 'Friendly lecture',
      complexity: s.settings?.complexity || 'standard',
      paragraphLength: s.settings?.paragraphLength || 'medium',
      paragraphCount: parseInt(s.settings?.paragraphCount, 10) || 3,
      imageDensity: s.settings?.imageDensity || 'balanced',
      language: '',
      audience: '',
      customInstructions: String(s.customMessage || '').trim(),
    };
    appState.suggestedGuidance = String(s.customMessage || '').trim();
    loadPath(app, s.topic, appState.suggestedGuidance || undefined, s.settings?.level ? [s.settings.level] : undefined, { fromHistory: true, fresh: true });
  };

  return (
    <section style={{ maxWidth: 760, margin: '36px auto 0' }}>
      <h4 className="activity-heading" style={{ margin: '0 0 2px', opacity: 0.9 }}>Suggested topic</h4>
      <InstructionPlank>A topic picked from your history. Refresh for another, or press play to start.</InstructionPlank>
      <div className="card" style={{ maxWidth: 760, margin: '0 auto 0', padding: '14px 16px' }}>
        <div className="slide-actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {hasSuggestion && <p style={{ margin: 0, fontWeight: 700 }}>{s.topic}</p>}
          <button className="btn small blue" id="refresh-suggested-topic" disabled={busy} onClick={refresh}>
            {busy ? 'Refreshing suggestion…' : '↻ Refresh suggestion'}
          </button>
        </div>
        {hasSuggestion ? (
          <>
            <div className="summary-card" style={{ padding: '10px 12px', borderRadius: 14 }}>
              <p style={{ margin: 0, fontSize: '.95rem' }}>{s.why || ''}</p>
              {Array.isArray(s.honorableMentions) && s.honorableMentions.length > 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '.9rem' }}><b>Mentions:</b> {s.honorableMentions.join(' · ')}</p>
              )}
              <p style={{ margin: '8px 0 0', padding: '8px 10px', border: '1px dashed #2d2a26', borderRadius: 10, background: '#fff8da', fontSize: '.88rem' }}>
                <b>Recommended setup:</b> {setupReceipt}
              </p>
              {s.customMessage && <p style={{ margin: '6px 0 0', fontSize: '.88rem' }}><b>Prompt:</b> {s.customMessage}</p>}
            </div>
            <div className="slide-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
              <button className="btn green" id="use-suggested-topic" onClick={use}>Use this suggestion →</button>
            </div>
          </>
        ) : s?.error ? (
          <p style={{ opacity: 0.85 }}>{s.why || 'Could not load suggestion right now. Press refresh to retry.'}</p>
        ) : (
          <p style={{ opacity: 0.75 }}>Generating your suggestion…</p>
        )}
      </div>
    </section>
  );
}
