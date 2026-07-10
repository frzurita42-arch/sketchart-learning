'use client';
/* Learning Path activity: the "type a topic / pick a chip" card on the home feed.
 * Ported from public/js/activities/learning-path.js. */
import { useState } from 'react';
import { API } from '@/lib/api';
import { appState } from '@/lib/app-state';
import { shuffled, withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { loadPath } from '@/lib/flows';
import { triggerHomePreloads } from '@/lib/home-preloads';
import { InstructionPlank } from './InstructionPlank';

export function LearningPath() {
  const app = useApp();
  const [custom, setCustom] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const start = (topic: string) => {
    if (!topic) return;
    triggerHomePreloads(topic);
    appState.suggestedSettings = null;
    appState.suggestedGuidance = '';
    loadPath(app, topic);
  };

  const refreshTopics = async () => {
    setRefreshing(true);
    try {
      const r = await withTimeout(API.post('/api/ai/topics', {
        count: 12,
        avoid: appState.homeTopics,
        refresh: true,
        triggerTopic: appState.topic || '',
      }), 25000, 'Topic refresh timed out. Please retry.');
      if (r && Array.isArray(r.topics)) {
        const fromAI: string[] = r.topics.map((t: any) => t.name).filter(Boolean);
        if (fromAI.length) appState.homeTopics = shuffled<string>(fromAI).slice(0, 12);
        triggerHomePreloads(appState.homeTopics[0] || '');
        app.rerender();
      }
      setRefreshing(false);
    } catch (err: any) {
      setRefreshing(false);
      alert(`Could not refresh topics: ${err.message}`);
    }
  };

  return (
    <section style={{ maxWidth: 860, margin: '18px auto 0' }}>
      <h4 className="activity-heading" style={{ margin: '0 0 6px', opacity: 0.9, maxWidth: 760 }}>Start a Learning path</h4>
      <InstructionPlank>Type a topic or tap one below — I sketch a full, playable lesson path for it.</InstructionPlank>
      <div className="card alt" style={{ maxWidth: 560, margin: '12px auto 0' }}>
        <label className="field"><span>Type a topic to learn</span>
          <input type="text" id="custom-topic" placeholder="e.g. Renaissance art, Rust programming, beekeeping…"
            value={custom} onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') start(custom.trim()); }} /></label>
        <button className="btn primary" id="custom-topic-btn" onClick={() => start(custom.trim())}>Draw my path →</button>
      </div>
      <div className="chip-row" style={{ marginTop: 16 }}>
        {(appState.homeTopics || []).map((t: string) => (
          <button key={t} className="chip" data-topic={t} onClick={() => start(t)}>{t}</button>
        ))}
      </div>
      <div className="slide-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
        <button className="btn small blue" id="refresh-home-topics" disabled={refreshing} onClick={refreshTopics}>
          {refreshing ? 'Refreshing ideas…' : '↻ Refresh 12 topic ideas'}
        </button>
      </div>
    </section>
  );
}
