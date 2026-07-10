'use client';
/* Activity settings form. Ported from viewSettings() in public/js/flows/path.js. */
import { useState } from 'react';
import { appState, LEVELS, TONES } from '@/lib/app-state';
import { useApp } from '@/components/AppContext';

function initialForm() {
  const preset = appState.suggestedSettings || null;
  const base = {
    lengthSel: '7', lengthCustom: 5, paragraph: 'medium', paraCount: 3,
    toneSel: TONES[0], toneCustom: '', complexity: 'standard', density: 'balanced',
    language: '', audience: '', instructions: '',
  };
  if (!preset) return base;
  const len = Math.min(20, Math.max(2, parseInt(preset.totalSlides, 10) || 7));
  if ([4, 7, 10].includes(len)) { base.lengthSel = String(len); } else { base.lengthSel = 'custom'; base.lengthCustom = len; }
  if (preset.paragraphLength) base.paragraph = preset.paragraphLength;
  base.paraCount = Math.min(7, Math.max(1, parseInt(preset.paragraphCount, 10) || 3));
  if (preset.complexity) base.complexity = preset.complexity;
  if (preset.imageDensity) base.density = preset.imageDensity;
  if (preset.language) base.language = preset.language;
  if (preset.audience) base.audience = preset.audience;
  if (preset.customInstructions) base.instructions = preset.customInstructions;
  if (preset.tone && TONES.includes(preset.tone)) base.toneSel = preset.tone;
  else if (preset.tone) { base.toneSel = 'custom'; base.toneCustom = preset.tone; }
  return base;
}

export function SettingsView() {
  const app = useApp();
  const [f, setF] = useState(initialForm);
  const patch = (p: any) => setF(prev => ({ ...prev, ...p }));

  if (!appState.concept) { app.nav('home'); return null; }

  const start = () => {
    const totalSlides = f.lengthSel === 'custom'
      ? Math.min(20, Math.max(2, parseInt(String(f.lengthCustom), 10) || 5))
      : parseInt(f.lengthSel, 10);
    const tone = f.toneSel === 'custom' ? (f.toneCustom.trim() || 'friendly lecture') : f.toneSel;
    appState.settings = {
      totalSlides,
      tone,
      activityType: appState.suggestedSettings?.activityType || (appState.latexLab?.exampleType ? 'structured-explanation' : ''),
      exampleType: appState.suggestedSettings?.exampleType || appState.latexLab?.exampleType || '',
      complexity: f.complexity,
      paragraphLength: f.paragraph,
      paragraphCount: parseInt(String(f.paraCount), 10) || 3,
      imageDensity: f.density,
      language: f.language.trim(),
      audience: f.audience.trim(),
      customInstructions: f.instructions.trim(),
    };
    appState.game = null; // fresh game on start
    app.nav('activity');
  };

  return (
    <>
      <h1 className="view-title">Set up your <span className="scribble-underline">reading activity</span></h1>
      <p className="view-sub">{appState.concept} · {appState.level} · {appState.topic}</p>
      {appState.suggestedGuidance && (
        <div className="card alt" style={{ marginBottom: 12 }}>
          <b>Suggested prompt</b>
          <p style={{ marginTop: 6 }}>{appState.suggestedGuidance}</p>
          <p className="muted-line">You can still customize every setting below.</p>
        </div>
      )}
      <div className="settings-grid">
        <div className="card">
          <h3>📏 Length</h3>
          <label className="field"><span>How many slides?</span>
            <select id="set-length" value={f.lengthSel} onChange={e => patch({ lengthSel: e.target.value })}>
              <option value="4">Short — 4 slides</option>
              <option value="7">Medium — 7 slides</option>
              <option value="10">Long — 10 slides</option>
              <option value="custom">Custom…</option>
            </select></label>
          <label className={`field${f.lengthSel === 'custom' ? '' : ' hidden'}`} id="custom-length-wrap"><span>Number of slides (2–20)</span>
            <input type="number" id="set-length-custom" min={2} max={20} value={f.lengthCustom} onChange={e => patch({ lengthCustom: e.target.value })} /></label>
          <label className="field"><span>Paragraph length</span>
            <select id="set-paragraph" value={f.paragraph} onChange={e => patch({ paragraph: e.target.value })}>
              <option value="brief">Brief — a few sentences</option>
              <option value="medium">Medium — a solid paragraph</option>
              <option value="detailed">Detailed — a long paragraph</option>
            </select></label>
          <label className="field"><span>Paragraphs per slide: <b id="para-count-val">{f.paraCount}</b></span>
            <input type="range" id="set-paragraph-count" min={1} max={7} step={1} value={f.paraCount} onChange={e => patch({ paraCount: parseInt(e.target.value, 10) })} /></label>
        </div>
        <div className="card alt">
          <h3>🎭 Voice</h3>
          <label className="field"><span>Tone / sentiment</span>
            <select id="set-tone" value={f.toneSel} onChange={e => patch({ toneSel: e.target.value })}>
              {TONES.map(t => <option key={t}>{t}</option>)}
              <option value="custom">Custom…</option>
            </select></label>
          <label className={`field${f.toneSel === 'custom' ? '' : ' hidden'}`} id="custom-tone-wrap"><span>Describe the tone</span>
            <input type="text" id="set-tone-custom" value={f.toneCustom} onChange={e => patch({ toneCustom: e.target.value })} placeholder="e.g. like a pirate telling sea stories" /></label>
          <label className="field"><span>Text complexity</span>
            <select id="set-complexity" value={f.complexity} onChange={e => patch({ complexity: e.target.value })}>
              <option value="simple">Simple — plain words, short sentences</option>
              <option value="standard">Standard</option>
              <option value="scholarly">Scholarly — technical vocabulary</option>
            </select></label>
        </div>
        <div className="card">
          <h3>🖼️ Pictures vs. text</h3>
          <label className="field"><span>How visual should slides be?</span>
            <select id="set-density" value={f.density} onChange={e => patch({ density: e.target.value })}>
              <option value="text-only">No images — text only</option>
              <option value="mostly-text">Mostly text, occasional sketch</option>
              <option value="balanced">Balanced — one sketch per slide</option>
              <option value="mostly-visual">Mostly sketches &amp; graphs, little text</option>
            </select></label>
        </div>
        <div className="card alt">
          <h3>🖋️ Your own rules <small style={{ fontWeight: 'normal' }}>(optional)</small></h3>
          <label className="field"><span>Language</span>
            <input type="text" id="set-language" value={f.language} onChange={e => patch({ language: e.target.value })} placeholder="e.g. English, Español, Français…" /></label>
          <label className="field"><span>Who is this for?</span>
            <input type="text" id="set-audience" value={f.audience} onChange={e => patch({ audience: e.target.value })} placeholder="e.g. a curious 12-year-old, a med student…" /></label>
          <label className="field"><span>Custom instructions for the AI</span>
            <textarea id="set-instructions" rows={3} value={f.instructions} onChange={e => patch({ instructions: e.target.value })} placeholder="e.g. use soccer analogies, add historical anecdotes, avoid formulas…" /></label>
        </div>
      </div>
      <div className="slide-actions" style={{ justifyContent: 'center', marginTop: 24 }}>
        <button className="btn" onClick={() => app.nav('path')}>← Back to path</button>
        <button className="btn primary" id="start-btn" style={{ fontSize: '1.3rem' }} onClick={start}>Start learning ✏️</button>
      </div>
    </>
  );
}
