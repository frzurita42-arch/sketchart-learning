'use client';
/* The adaptive slide game: request/show slides, prefetch every answer branch,
 * handle answers + instant advance, timer, and the final results slide.
 * Ported from public/js/game/engine.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '@/lib/api';
import { appState } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { SlideComponents } from '@/components/ui/SlideComponents';
import { Loading } from '@/components/ui/Loading';
import { clearSlideMem, memGetSlide, memPutSlide } from '@/lib/slide-memory';

function shuffleInPlace(arr: any[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function enforceGraphOnlyClient(slide: any, game: any) {
  if (game?.settings?.imageDensity !== 'text-only') return slide;
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  slide.components = comps.filter((c: any) => !['svg', 'image', 'latex', 'code', 'table'].includes(c?.type));
  return slide;
}

function summarizeSlideVisuals(slide: any): string[] {
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  const toText = (v: any) => String(v || '').trim();
  return comps
    .filter((c: any) => ['table', 'svg', 'image', 'latex', 'code'].includes(c?.type))
    .map((c: any) => {
      if (c.type === 'table') {
        const headers = Array.isArray(c.headers) ? c.headers.join(' | ') : '';
        const firstRow = Array.isArray(c.rows) && c.rows[0] ? c.rows[0].join(' | ') : '';
        const secondRow = Array.isArray(c.rows) && c.rows[1] ? c.rows[1].join(' | ') : '';
        return `table:${toText(c.caption)}::${toText(headers)}::${toText(firstRow)}::${toText(secondRow)}`.slice(0, 220);
      }
      if (c.type === 'svg') return `svg:${toText(c.caption)}::${toText(String(c.svg || '').replace(/\s+/g, ' ').slice(0, 120))}`.slice(0, 220);
      if (c.type === 'image') {
        const urlHead = toText(String(c.url || '').slice(0, 180));
        return `image:${toText(c.caption || c.prompt || c.alt)}::${toText(c.prompt || '')}::${urlHead}`.slice(0, 300);
      }
      if (c.type === 'latex') return `latex:${toText(c.caption || '')}::${toText(c.content || '')}`.slice(0, 220);
      if (c.type === 'code') return `code:${toText(c.language)}:${toText(c.content).split('\n')[0]}`.slice(0, 180);
      return '';
    })
    .filter(Boolean);
}

function branchFor(slide: any, option: any) {
  const visualRefs = summarizeSlideVisuals(slide);
  return {
    chosenText: option.text,
    correct: !!option.correct,
    misconception: option.misconception || '',
    historyEntry: {
      title: slide.title, summary: slide.summary,
      question: slide.quiz.question, chosen: option.text, correct: !!option.correct,
      visualRefs,
    },
  };
}

type Ui = 'loading' | 'slide' | 'error' | 'finished';

export function GameView() {
  const app = useApp();
  const g = useRef<any>(null);
  const [ui, setUi] = useState<Ui>('loading');
  const [loadingMsg, setLoadingMsg] = useState('The AI is sketching slide 1…');
  const [answered, setAnswered] = useState<any>(null);
  const [errInfo, setErrInfo] = useState<{ message: string; retry: () => void } | null>(null);
  const [results, setResults] = useState<any>(null);
  const [, bump] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const started = useRef(false);

  const requestSlide = useCallback((branch: any, slideNumber?: number) => {
    const gg = g.current;
    return API.post('/api/ai/slide', {
      gameId: gg.id, topic: gg.topic, concept: gg.concept, level: gg.level,
      settings: gg.settings,
      slideNumber: slideNumber || gg.slideNumber,
      totalSlides: gg.settings.totalSlides,
      history: branch ? [...gg.history, branch.historyEntry] : gg.history,
      branch: branch ? { chosenText: branch.chosenText, correct: branch.correct, misconception: branch.misconception } : null,
    });
  }, []);

  const gameError = useCallback((e: any, retry: () => void) => {
    setErrInfo({ message: e.message, retry });
    setUi('error');
  }, []);

  const showSlide = useCallback((slide: any) => {
    const gg = g.current;
    window.scrollTo(0, 0);
    slide = enforceGraphOnlyClient(slide, gg);
    if (slide.quiz && Array.isArray(slide.quiz.options)) shuffleInPlace(slide.quiz.options);
    gg.current = slide;

    // prefetch: generate the next slide for EVERY option now, in the background.
    gg.prefetch = null;
    gg.prefetchReady = {};
    if (gg.slideNumber < gg.settings.totalSlides) {
      gg.prefetch = slide.quiz.options.map((o: any, i: number) => {
        const branch = branchFor(slide, o);
        const cached = memGetSlide(gg.id, gg.slideNumber + 1, branch.chosenText);
        const promise = cached ? Promise.resolve(cached) : requestSlide(branch, gg.slideNumber + 1);
        promise.then((s: any) => { gg.prefetchReady[i] = s; memPutSlide(gg.id, gg.slideNumber + 1, branch.chosenText, s); }).catch(() => {});
        return promise;
      });
    }

    setAnswered(null);
    setUi('slide');
    bump(n => n + 1);
  }, [requestSlide]);

  const startGame = useCallback(() => {
    clearSlideMem();
    const gg = {
      id: crypto.randomUUID(),
      topic: appState.topic, concept: appState.concept, level: appState.level,
      settings: appState.settings,
      slideNumber: 1,
      history: [] as any[],
      answers: [] as any[],
      prefetch: null as any,
      prefetchReady: {} as any,
      startTime: Date.now(),
      finished: false,
      current: null as any,
    };
    g.current = gg;
    appState.game = gg;
    setResults(null);
    setErrInfo(null);
    setUi('loading');
    setLoadingMsg('The AI is sketching slide 1…');
    requestSlide(null).then(showSlide).catch((e: any) => gameError(e, startGame));
  }, [requestSlide, showSlide, gameError]);

  // Start the game once on mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startGame();
  }, [startGame]);

  // Timer: tick every second while a slide is showing.
  useEffect(() => {
    if (ui !== 'slide') return;
    const id = setInterval(() => setNowTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [ui]);

  const answer = (idx: number) => {
    const gg = g.current;
    const slide = gg.current;
    const opt = slide.quiz.options[idx];
    const correctIdx = slide.quiz.options.findIndex((o: any) => o.correct);
    const branch = branchFor(slide, opt);
    gg.answers.push({
      slide: gg.slideNumber, title: slide.title, question: slide.quiz.question,
      chosen: opt.text, correct: !!opt.correct, misconception: opt.misconception || '',
    });
    gg.history.push(branch.historyEntry);
    setAnswered({ idx, opt, correctIdx, branch });
  };

  const advance = async (idx: number, branch: any) => {
    const gg = g.current;
    try {
      let slide = (gg.prefetchReady && gg.prefetchReady[idx]) || null;
      if (!slide) {
        window.scrollTo(0, 0);
        setUi('loading');
        setLoadingMsg('Turning the page…');
        try {
          slide = await gg.prefetch[idx];
        } catch {
          slide = memGetSlide(gg.id, gg.slideNumber + 1, branch.chosenText)
            || await requestSlide(branch, gg.slideNumber + 1);
        }
      }
      memPutSlide(gg.id, gg.slideNumber + 1, branch.chosenText, slide);
      gg.slideNumber++;
      showSlide(slide);
    } catch (e) { gameError(e, () => advance(idx, branch)); }
  };

  const finishGame = async () => {
    const gg = g.current;
    gg.finished = true;
    clearSlideMem(gg.id);
    const durationSec = Math.floor((Date.now() - gg.startTime) / 1000);
    const correct = gg.answers.filter((a: any) => a.correct).length;
    const total = gg.answers.length;
    const questionSummary = gg.answers.map((a: any) => a.question).filter(Boolean).join(', ');
    const answerSummary = gg.answers.map((a: any) => a.chosen).filter(Boolean).join(', ');

    setUi('loading');
    setLoadingMsg('Grading your sketchbook…');

    let rec: any = null;
    let gradingNote = '';
    try {
      rec = await withTimeout(API.post('/api/ai/recommend', {
        topic: gg.topic, concept: gg.concept, level: gg.level,
        correct, total, durationSec, slides: gg.answers,
      }), 12000, 'Coach grading took too long. Showing report without coach notes.');
    } catch (e: any) {
      gradingNote = e.message || 'Coach grading was unavailable. Showing report without coach notes.';
    }

    let saveNote = '';
    let saved: any = null;
    try {
      saved = await withTimeout(API.post('/api/games', {
        topic: gg.topic, concept: gg.concept, level: gg.level, settings: gg.settings,
        slides: gg.answers, correct, total, durationSec, recommendations: rec,
        questionSummary, answerSummary, aiNotes: rec?.aiNotes || [],
      }), 12000, 'Saving took too long. Report is visible, but this run may not be in history yet.');
    } catch (e: any) { saveNote = `Could not save this run: ${e.message}`; }

    const mins = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`;
    setResults({
      concept: gg.concept, level: gg.level, topic: gg.topic,
      username: API.user?.username, correct, total, mins,
      dateStr: new Date().toLocaleDateString(),
      timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      shareUrl: saved?.shareUrl || '',
      rec, gradingNote, saveNote, answers: gg.answers,
    });
    appState.game = null;
    setUi('finished');
  };

  // ---------------- render ----------------
  if (ui === 'loading') return <Loading text={loadingMsg} />;

  if (ui === 'error' && errInfo) {
    return (
      <div className="card">
        <p>😖 The AI pencil broke: {errInfo.message}</p>
        <div className="slide-actions">
          <button className="btn" id="ge-home" onClick={() => { appState.game = null; app.nav('home'); }}>Quit</button>
          <button className="btn primary" id="ge-retry" onClick={errInfo.retry}>Try again</button>
        </div>
      </div>
    );
  }

  if (ui === 'finished' && results) return <Results r={results} onStats={() => app.nav('stats')} onAgain={() => app.nav('settings')} onNew={() => app.nav('home')} />;

  const gg = g.current;
  if (ui === 'slide' && gg?.current) {
    const slide = gg.current;
    const total = gg.settings.totalSlides;
    const pct = Math.round(100 * (gg.slideNumber - 1) / total);
    const elapsed = Math.floor((Date.now() - gg.startTime) / 1000);
    const isLast = gg.slideNumber >= total;
    void nowTick; // re-render each tick for the timer

    return (
      <div className="slide-shell">
        <div className="progress-row">
          <span>Slide {gg.slideNumber}/{total}</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span id="game-timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
        </div>
        <div className="slide">
          <h2>{slide.title}</h2>
          <SlideComponents components={slide.components} />
          <div className="quiz-box">
            <p className="quiz-q">🤔 {slide.quiz.question}</p>
            <div className="quiz-options">
              {slide.quiz.options.map((o: any, i: number) => {
                let cls = 'quiz-opt';
                if (answered) {
                  if (i === answered.idx) cls += answered.opt.correct ? ' picked-correct' : ' picked-wrong';
                  else if (i === answered.correctIdx && !answered.opt.correct) cls += ' reveal-correct';
                }
                return (
                  <button key={i} className={cls} data-i={i} disabled={!!answered} onClick={() => answer(i)}>
                    {'ABCD'[i] || '•'}){' '} {o.text}
                  </button>
                );
              })}
            </div>
            <div id="quiz-feedback">
              {answered && (
                <div className={`quiz-feedback ${answered.opt.correct ? 'good' : 'bad'}`}>
                  <b>{answered.opt.correct ? '✔ Correct!' : '✘ Not quite.'}</b>{' '}
                  {answered.opt.explanation || ''}
                  {!isLast && (answered.opt.correct ? ' The next slide digs deeper.' : ' The next slide takes a detour to fix this idea.')}
                </div>
              )}
            </div>
          </div>
          <div className="slide-actions" id="slide-actions">
            {answered && (isLast
              ? <button className="btn primary" id="next-btn" onClick={finishGame}>See my results 🏁</button>
              : <button className="btn primary" id="next-btn" onClick={() => advance(answered.idx, answered.branch)}>Next slide →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <Loading text={loadingMsg} />;
}

function Results({ r, onStats, onAgain, onNew }: { r: any; onStats: () => void; onAgain: () => void; onNew: () => void }) {
  const rec = r.rec;
  const [copied, setCopied] = useState(false);
  return (
    <div className="slide-shell">
      <div className="slide">
        <h2>🏁 {r.concept} — your results</h2>
        <p><b>{r.username}</b> · {r.level} · {r.topic}</p>
        <p className="muted-line">Completed on {r.dateStr} at {r.timeStr}</p>
        <div className="stat-row">
          <div className="stat-tile"><div className="big">{r.correct}/{r.total}</div>correct</div>
          <div className="stat-tile"><div className="big">{r.total ? Math.round(100 * r.correct / r.total) : 0}%</div>score</div>
          <div className="stat-tile"><div className="big">{r.mins}</div>time</div>
        </div>
        {r.shareUrl && (
          <div className="share-box">
            <div><b>Shareable report</b><br /><a href={r.shareUrl} target="_blank" rel="noreferrer">{r.shareUrl}</a></div>
            <button className="btn small" id="copy-share" onClick={() => { navigator.clipboard?.writeText(r.shareUrl); setCopied(true); }}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
        )}
        {Array.isArray(rec?.aiNotes) && rec.aiNotes.length > 0 && (
          <div className="quiz-feedback" style={{ marginTop: 14 }}>
            <b>AI notes</b>
            <ul style={{ paddingLeft: 22, marginTop: 6 }}>{rec.aiNotes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        <div className="table-wrap"><table className="sketch">
          <tbody>
            <tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th><th>AI notes</th></tr>
            {r.answers.map((a: any, i: number) => (
              <tr key={i}>
                <td>{a.slide}</td><td>{a.question}</td><td>{a.chosen}</td><td>{a.correct ? '✔' : '✘'}</td>
                <td className="clamped">{Array.isArray(rec?.aiNotes) ? rec.aiNotes.join(' · ') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {rec && (
          <div className="quiz-feedback" style={{ marginTop: 18 }}>
            <p><b>Coach says:</b> {rec.summary || ''}</p>
            <ul style={{ paddingLeft: 22, marginTop: 6 }}>{(rec.recommendations || []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
            {(rec.nextConcepts || []).length > 0 && (
              <p style={{ marginTop: 6 }}><b>Try next:</b> {rec.nextConcepts.map((n: any) => `${n.name} (${n.level})`).join(' · ')}</p>
            )}
          </div>
        )}
        {r.gradingNote && <p className="form-error">{r.gradingNote}</p>}
        {r.saveNote && <p className="form-error">{r.saveNote}</p>}
        <div className="slide-actions">
          <button className="btn" id="fin-stats" onClick={onStats}>My stats</button>
          <button className="btn blue" id="fin-again" onClick={onAgain}>Same concept again</button>
          <button className="btn primary" id="fin-new" onClick={onNew}>New topic</button>
        </div>
      </div>
    </div>
  );
}
