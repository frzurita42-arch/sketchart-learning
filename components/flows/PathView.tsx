'use client';
/* Learning-path view: shows the generated path, redraw/fresh controls, and
 * per-level concept refresh. Ported from viewPath() in public/js/flows/path.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { appState, LEVELS } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { loadPath } from '@/lib/flows';
import { Loading } from '@/components/ui/Loading';

export function PathView() {
  const app = useApp();
  const p = appState.path;
  const [guidance, setGuidance] = useState('');
  const [selected, setSelected] = useState<string[]>(() => [...LEVELS]);
  const [customConcept, setCustomConcept] = useState('');
  const [customLevel, setCustomLevel] = useState(LEVELS[0]);
  const [refreshingLevel, setRefreshingLevel] = useState<string | null>(null);
  const [, force] = useState(0);

  if (appState.pathLoading) return <Loading text={appState.pathLoading} />;

  if (appState.pathError) {
    const req = appState.pathRequest || {};
    return (
      <div className="card">
        <p>😖 Could not draw the path: {appState.pathError}</p>
        <div className="slide-actions">
          <button className="btn" onClick={() => app.nav('home')}>← Back</button>
          <button className="btn primary" id="retry" onClick={() => loadPath(app, req.topic, req.guidance, req.levels, req.opts || {})}>Try again</button>
        </div>
      </div>
    );
  }

  if (!p) { app.nav('home'); return null; }

  const toggleLevel = (l: string) =>
    setSelected(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);

  const redraw = (fresh: boolean) => {
    const g = guidance.trim() || undefined;
    const levels = selected;
    loadPath(app, appState.topic as string, g, levels.length ? levels : undefined, fresh ? { fromHistory: true, fresh: true } : {});
  };

  const refreshLevel = async (level: string) => {
    const lv = (appState.path.levels || []).find((x: any) => x.level === level);
    if (!lv) return;
    const count = Math.max(1, (lv.concepts || []).length || 5);
    const g = guidance.trim() || undefined;
    const avoid = (lv.concepts || []).map((c: any) => c.name).filter(Boolean);
    setRefreshingLevel(level);
    try {
      const refreshed = await withTimeout(API.post('/api/ai/path/level-refresh', {
        topic: appState.topic, level, count, avoidConcepts: avoid, guidance: g,
      }), 25000, `${level} refresh timed out. Please retry.`);
      appState.path.levels = (appState.path.levels || []).map((x: any) => x.level === level
        ? { ...x, description: refreshed.description || x.description, concepts: (refreshed.concepts || []).length ? refreshed.concepts : x.concepts }
        : x);
      setRefreshingLevel(null);
      force(n => n + 1);
    } catch (err: any) {
      setRefreshingLevel(null);
      alert(`Could not refresh ${level}: ${err.message}`);
    }
  };

  const pickConcept = (name: string, level: string) => {
    appState.concept = name; appState.level = level; app.nav('settings');
  };

  const studyCustom = () => {
    const c = customConcept.trim();
    if (!c) return;
    appState.concept = c; appState.level = customLevel; app.nav('settings');
  };

  return (
    <>
      <h1 className="view-title"><span className="scribble-underline">{p.topic || appState.topic}</span> path</h1>
      <p className="view-sub">{p.overview || ''}</p>
      <div className="card alt">
        <b>Not quite right? Redraw it.</b>
        <label className="field" style={{ marginTop: 8 }}><span>Tell the AI how to adjust the path (optional)</span>
          <textarea id="path-guidance" rows={2} value={guidance} onChange={e => setGuidance(e.target.value)}
            placeholder="e.g. focus on practical projects, I already know the basics, prepare me for an exam…" /></label>
        <div className="chip-row" style={{ justifyContent: 'flex-start' }} id="level-filter">
          {LEVELS.map(l => (
            <button key={l} className={`chip${selected.includes(l) ? ' selected' : ''}`} data-level={l} onClick={() => toggleLevel(l)}>{l}</button>
          ))}
        </div>
        <div className="slide-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn blue" id="redraw-btn" onClick={() => redraw(false)}>↻ Redraw path</button>
          <button className="btn green" id="fresh-btn" title="New concept picks based on what you've already studied" onClick={() => redraw(true)}>🔄 Fresh picks from my history</button>
        </div>
      </div>
      {(p.levels || []).map((lv: any) => (
        <div className="level-block" key={lv.level}>
          <div className="level-head">
            <h3>{lv.level}</h3>
            <button className="btn small" data-refresh-level={lv.level} disabled={refreshingLevel === lv.level} onClick={() => refreshLevel(lv.level)}>
              {refreshingLevel === lv.level ? 'Refreshing…' : `↻ Refresh ${Math.max(1, (lv.concepts || []).length)} concepts`}
            </button>
          </div>
          <p className="level-desc">{lv.description || ''}</p>
          <div className="concept-grid">
            {(lv.concepts || []).map((c: any) => (
              <button className="concept-card" key={c.name} data-concept={c.name} data-level={lv.level} onClick={() => pickConcept(c.name, lv.level)}>
                <b>{c.name}</b>{c.blurb || ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="card">
        <b>Or study your own concept</b>
        <label className="field" style={{ marginTop: 8 }}><span>Custom concept</span>
          <input type="text" id="custom-concept" value={customConcept} onChange={e => setCustomConcept(e.target.value)}
            placeholder="e.g. the Krebs cycle, Fourier transforms…" /></label>
        <label className="field"><span>At what level?</span>
          <select id="custom-concept-level" value={customLevel} onChange={e => setCustomLevel(e.target.value)}>
            {LEVELS.map(l => <option key={l}>{l}</option>)}
          </select></label>
        <button className="btn primary" id="custom-concept-btn" onClick={studyCustom}>Study this →</button>
      </div>
    </>
  );
}
