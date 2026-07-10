'use client';
/* Structured Explanations activity: a formula/concept turned into step-by-step
 * proof / worked-example slides, with an AI "suggest topic + settings" helper.
 * Ported from public/js/activities/structured-explanations.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { appState, LEVELS, TONES } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { loadPath } from '@/lib/flows';
import { triggerHomePreloads } from '@/lib/home-preloads';
import { InstructionPlank } from './InstructionPlank';

function normalizeStructuredSuggestion(raw: any = {}) {
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
    alternateVisualMath: raw.alternateVisualMath !== false,
  };
}

function localStructuredSuggestion() {
  const candidates = [
    'Bayes theorem for diagnostic testing',
    'Taylor series approximation for sin(x)',
    'Dijkstra shortest-path proof intuition',
    'Supply-demand equilibrium with elasticity table',
    'Decision tree entropy and information gain',
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
    alternateVisualMath: Math.random() < 0.8,
  };
}

export function StructuredExplanations() {
  const app = useApp();
  const [ml, setMl] = useState<any>({ ...appState.latexLab });
  const [busy, setBusy] = useState(false);
  const patch = (p: any) => setMl((prev: any) => { const next = { ...prev, ...p }; appState.latexLab = next; return next; });

  const suggest = async () => {
    setBusy(true);
    try {
      const r = await withTimeout(API.post('/api/ai/structured-explanation-suggest', {
        avoidPrompts: [appState.latexLab?.prompt, ml.prompt].filter(Boolean),
      }), 15000, 'Suggestion timed out.');
      patch(normalizeStructuredSuggestion(r));
    } catch {
      patch(localStructuredSuggestion());
    }
    setBusy(false);
  };

  const start = () => {
    const prompt = (ml.prompt || '').trim();
    if (!prompt) { alert('Please enter a formula, concept, or example type first.'); return; }
    const exampleType = ml.exampleType || 'proof';
    const level = ml.level || 'Upper Intermediate';
    const tone = ml.tone || 'Friendly lecture';
    const complexity = ml.complexity || 'standard';
    const totalSlides = Math.min(20, Math.max(2, parseInt(ml.totalSlides, 10) || 8));
    const paragraphLength = ml.paragraphLength || 'medium';
    const imageDensity = ml.imageDensity || 'balanced';
    const continuation = ml.continuation || 'related-topics';
    const alternate = !!ml.alternateVisualMath;
    const paragraphCount = complexity === 'scholarly' ? 4 : (complexity === 'simple' ? 2 : 3);

    appState.latexLab = { prompt, exampleType, level, tone, complexity, paragraphLength, imageDensity, totalSlides, continuation, alternateVisualMath: alternate };

    const modeMap: Record<string, string> = {
      proof: 'formal proof steps and derivations',
      'worked-example': 'step-by-step worked examples',
      'graph-table': 'graphs and tables with interpretation',
      'tree-diagram': 'tree play-out or diagram-based reasoning',
      outline: 'structured outline with key claims and dependencies',
    };
    const continuationMap: Record<string, string> = {
      'more-examples': 'Continue with more examples of the same type after each core explanation.',
      'different-examples': 'Continue with different examples that test the same principle in varied contexts.',
      'related-topics': 'Continue toward adjacent related topics once the core concept is stabilized.',
    };
    const alternationLine = alternate
      ? 'Alternate slide modes: one slide with visual/story explanation, then one slide with mathematical steps/proof/code/latex. Repeat this alternation.'
      : 'Blend visual and mathematical content on each slide without strict alternation.';

    appState.suggestedSettings = {
      totalSlides, tone, exampleType, activityType: 'structured-explanation',
      complexity, paragraphLength, paragraphCount, imageDensity,
      language: '', audience: '',
      customInstructions: `Teach "${prompt}" as ${modeMap[exampleType] || modeMap.proof}. ${alternationLine} If this is a proof, every slide must show the actual derivation in LaTeX and continue from the previous slide rather than restarting. Accompany every equation/code/table/graph/diagram with written explanation aligned to ${level} difficulty and ${tone} tone. ${continuationMap[continuation] || continuationMap['related-topics']}`,
    };
    appState.suggestedGuidance = `Build a rigorous but clear learning path for "${prompt}" focused on ${modeMap[exampleType] || modeMap.proof}. If the example type is proof, every slide must include a displayed LaTeX proof block that continues the derivation from the previous answer. Use visual representations (trees, diagrams, tables, graphs, or sketches) when helpful, and always include explanatory text.`;
    triggerHomePreloads(prompt);
    loadPath(app, prompt, appState.suggestedGuidance, [level], { fromHistory: true, fresh: true });
  };

  return (
    <section style={{ maxWidth: 760, margin: '24px auto 0' }}>
      <h4 className="activity-heading" style={{ margin: '0 0 6px', opacity: 0.9 }}>Structured Explanations</h4>
      <InstructionPlank>Name a formula or concept — get a step-by-step proof or worked example as playable slides.</InstructionPlank>
      <div className="card alt" style={{ maxWidth: 760, margin: '0 auto 0', padding: '14px 16px' }}>
        <div className="slide-actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>Formula, concept, or example type</span>
          <button className="btn small blue" id="ml-suggest" disabled={busy} onClick={suggest}>
            {busy ? 'Suggesting…' : '✨ Suggest topic + settings'}
          </button>
        </div>
        <label className="field"><span style={{ display: 'none' }}>Formula, concept, or example type</span>
          <input type="text" id="ml-prompt" value={ml.prompt || ''} placeholder="e.g. Bayes theorem, Taylor series, shortest-path proof, decision tree split criteria"
            onChange={e => patch({ prompt: e.target.value })} /></label>
        <div className="card" style={{ padding: 12, marginTop: 8 }}>
          <div className="settings-compact">
            <label className="field"><span>Focus mode</span>
              <select id="ml-example-type" value={ml.exampleType} onChange={e => patch({ exampleType: e.target.value })}>
                <option value="proof">Formal proof / derivation</option>
                <option value="worked-example">Worked example</option>
                <option value="graph-table">Graph / table analysis</option>
                <option value="tree-diagram">Tree / diagram playout</option>
                <option value="outline">Concept outline</option>
              </select></label>
            <label className="field"><span>Difficulty level</span>
              <select id="ml-level" value={ml.level} onChange={e => patch({ level: e.target.value })}>
                {LEVELS.map(l => <option key={l}>{l}</option>)}
              </select></label>
            <label className="field"><span>Tone</span>
              <select id="ml-tone" value={ml.tone} onChange={e => patch({ tone: e.target.value })}>
                {TONES.map(t => <option key={t}>{t}</option>)}
              </select></label>
            <label className="field"><span>Text complexity</span>
              <select id="ml-complexity" value={ml.complexity} onChange={e => patch({ complexity: e.target.value })}>
                <option value="simple">Simple</option>
                <option value="standard">Standard</option>
                <option value="scholarly">Scholarly</option>
              </select></label>
            <label className="field"><span>Slides</span>
              <input type="number" id="ml-slides" min={2} max={20}
                value={Math.min(20, Math.max(2, parseInt(ml.totalSlides, 10) || 8))}
                onChange={e => patch({ totalSlides: e.target.value })} /></label>
            <label className="field"><span>Paragraph length</span>
              <select id="ml-paragraph-length" value={ml.paragraphLength} onChange={e => patch({ paragraphLength: e.target.value })}>
                <option value="brief">Brief</option>
                <option value="medium">Medium</option>
                <option value="detailed">Detailed</option>
              </select></label>
            <label className="field"><span>Support material ratio</span>
              <select id="ml-density" value={ml.imageDensity} onChange={e => patch({ imageDensity: e.target.value })}>
                <option value="text-only">Text only</option>
                <option value="mostly-text">Mostly text</option>
                <option value="balanced">Balanced</option>
                <option value="mostly-visual">Mostly support material</option>
              </select></label>
            <label className="field"><span>Continuation style</span>
              <select id="ml-continuation" value={ml.continuation} onChange={e => patch({ continuation: e.target.value })}>
                <option value="more-examples">Continue with more examples</option>
                <option value="different-examples">Continue with different examples</option>
                <option value="related-topics">Continue to related topics</option>
              </select></label>
            <label className="field alt-row"><span>
              <input type="checkbox" id="ml-alternate" checked={ml.alternateVisualMath !== false}
                onChange={e => patch({ alternateVisualMath: e.target.checked })} style={{ width: 'auto', marginRight: 8 }} />
              Alternate visual explanation pages with math/proof pages</span></label>
          </div>
        </div>
        <div className="slide-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
          <button className="btn green" id="ml-start" onClick={start}>Generate latex path →</button>
        </div>
      </div>
    </section>
  );
}
