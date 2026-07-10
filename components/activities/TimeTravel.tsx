'use client';
/* Time Travel activity: turn an era + headline into a playable news-story lesson.
 * Ported from public/js/activities/time-travel.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { appState, LEVELS } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { loadPath } from '@/lib/flows';
import { triggerHomePreloads } from '@/lib/home-preloads';
import { InstructionPlank } from './InstructionPlank';

function randomLocalHeadline(period = 'future', avoid: any[] = []): string {
  const pool: Record<string, string[]> = {
    past: [
      'Engineers Rebuild Ancient Port After Great Earthquake',
      'Royal Observatory Corrects Calendar with New Sky Tables',
      'City Council Launches First Public Sanitation Campaign',
    ],
    present: [
      'Coastal City Uses Sensor Network to Cut Flood Damage',
      'Community Team Deploys AI Triage for Emergency Clinics',
      'Schools Partner with Labs to Track Heat Wave Risks',
    ],
    future: [
      'Orbital Cities Vote on Shared Water Protocol for Drought Years',
      'Lunar Freight Network Stabilizes Food Prices Across Colonies',
      'Quantum Forecast Grid Gives Regions 30-Day Storm Lead Time',
    ],
  };
  const list = pool[period] || pool.future;
  const avoidSet = new Set((avoid || []).map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean));
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
    level, complexity, paragraphLength,
    paragraphCount: Math.min(7, Math.max(1, paragraphCount)),
    imageDensity, totalSlides: Math.min(20, Math.max(2, totalSlides)), tone,
  };
}

export function TimeTravel() {
  const app = useApp();
  const [tt, setTt] = useState<any>({ ...appState.timeTravel });
  const [busy, setBusy] = useState(false);
  const patch = (p: any) => setTt((prev: any) => { const next = { ...prev, ...p }; appState.timeTravel = next; return next; });

  const refreshHeadline = async () => {
    setBusy(true);
    const period = tt.period || 'future';
    let headline = '';
    try {
      const r = await withTimeout(API.post('/api/ai/time-travel-headline', {
        period, avoidHeadlines: [tt.headline, tt.headline].filter(Boolean),
      }), 15000, 'Headline generation timed out.');
      headline = String(r?.headline || '').trim();
    } catch {
      headline = randomLocalHeadline(period, [tt.headline]);
    }
    if (!headline) headline = randomLocalHeadline(period, [tt.headline]);
    const preset = randomTimeTravelSettings(period, headline);
    patch({ ...preset, period, headline });
    setBusy(false);
  };

  const onPeriod = (period: string) => {
    const headline = (tt.headline || '').trim();
    const preset = randomTimeTravelSettings(period, headline);
    patch({ ...preset, period, headline });
  };

  const startStory = () => {
    const period = tt.period || 'future';
    const level = tt.level || 'Lower Intermediate';
    const complexity = tt.complexity || 'standard';
    const paragraphLength = tt.paragraphLength || 'medium';
    const paragraphCount = Math.min(7, Math.max(1, parseInt(tt.paragraphCount, 10) || 3));
    const imageDensity = tt.imageDensity || 'balanced';
    const totalSlides = Math.min(20, Math.max(2, parseInt(tt.totalSlides, 10) || 7));
    const headline = (tt.headline || '').trim() || `Breaking news from the ${period}`;

    appState.timeTravel = { headline, period, level, complexity, paragraphLength, paragraphCount, imageDensity, totalSlides, tone: 'Storytelling' };
    appState.suggestedSettings = {
      totalSlides, tone: 'Storytelling', activityType: 'time-travel',
      complexity, paragraphLength, paragraphCount, imageDensity,
      language: '', audience: '',
      customInstructions: `Write this as a ${period} news story driven by the headline: "${headline}". Include realistic causes, impacts, and practical solutions.`,
    };
    appState.suggestedGuidance = `Build a ${period} time-travel news learning story around this headline: "${headline}". Keep it educational and problem-solving focused.`;
    triggerHomePreloads(headline);
    loadPath(app, headline, appState.suggestedGuidance, [level], { fromHistory: true, fresh: true });
  };

  return (
    <section style={{ maxWidth: 760, margin: '24px auto 0' }}>
      <h4 className="activity-heading" style={{ margin: '0 0 6px', opacity: 0.9 }}>Time Travel Activity</h4>
      <InstructionPlank>Set an era and a headline — it becomes a playable news story lesson with quizzes.</InstructionPlank>
      <div className="card alt" style={{ maxWidth: 760, margin: '0 auto 0', padding: '14px 16px' }}>
        <div className="slide-actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>Custom headline</span>
          <button className="btn small blue" id="tt-random-headline" disabled={busy} onClick={refreshHeadline}>
            {busy ? 'Generating…' : (tt.headline ? '↻ Refresh headline' : '🎲 Random headline')}
          </button>
        </div>
        <label className="field"><span style={{ display: 'none' }}>Custom headline</span>
          <input type="text" id="tt-headline" value={tt.headline || ''} placeholder="e.g. City on Mars unveils first interplanetary water treaty"
            onChange={e => patch({ headline: e.target.value })} /></label>
        <div className="card" style={{ padding: 12, marginTop: 8 }}>
          <div className="settings-compact">
            <label className="field"><span>Time period</span>
              <select id="tt-period" value={tt.period} onChange={e => onPeriod(e.target.value)}>
                <option value="past">Past</option>
                <option value="present">Present</option>
                <option value="future">Future</option>
              </select></label>
            <label className="field"><span>Reading level</span>
              <select id="tt-level" value={tt.level} onChange={e => patch({ level: e.target.value })}>
                {LEVELS.map(l => <option key={l}>{l}</option>)}
              </select></label>
            <label className="field"><span>Difficulty</span>
              <select id="tt-complexity" value={tt.complexity} onChange={e => patch({ complexity: e.target.value })}>
                <option value="simple">Simple</option>
                <option value="standard">Standard</option>
                <option value="scholarly">Scholarly</option>
              </select></label>
            <label className="field"><span>Paragraph length</span>
              <select id="tt-paragraph-length" value={tt.paragraphLength} onChange={e => patch({ paragraphLength: e.target.value })}>
                <option value="brief">Brief</option>
                <option value="medium">Medium</option>
                <option value="detailed">Detailed</option>
              </select></label>
            <label className="field"><span>Paragraphs per slide</span>
              <input type="number" id="tt-paragraph-count" min={1} max={7}
                value={Math.min(7, Math.max(1, parseInt(tt.paragraphCount, 10) || 3))}
                onChange={e => patch({ paragraphCount: e.target.value })} /></label>
            <label className="field"><span>Support material ratio</span>
              <select id="tt-density" value={tt.imageDensity} onChange={e => patch({ imageDensity: e.target.value })}>
                <option value="text-only">Text only</option>
                <option value="mostly-text">Mostly text</option>
                <option value="balanced">Balanced</option>
                <option value="mostly-visual">Mostly support material</option>
              </select></label>
            <label className="field"><span>Slides</span>
              <input type="number" id="tt-slides" min={2} max={20}
                value={Math.min(20, Math.max(2, parseInt(tt.totalSlides, 10) || 7))}
                onChange={e => patch({ totalSlides: e.target.value })} /></label>
          </div>
        </div>
        <div className="slide-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
          <button className="btn green" id="tt-start-story" onClick={startStory}>Generate story path →</button>
        </div>
      </div>
    </section>
  );
}
