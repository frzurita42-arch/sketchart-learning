/* The adaptive slide game: request/show slides, prefetch every answer branch,
 * handle answers + instant advance, timer, and the final results slide. */
import { API } from '../core/api.js';
import { state, $app } from '../core/state.js';
import { withTimeout, hashText } from '../core/util.js';
import { esc, renderComponents, loadingHTML } from '../ui/index.js';
import { clearSlideMem, memGetSlide, memPutSlide } from './memory.js';
import { nav } from '../core/router.js';
import { viewSettings } from '../flows/path.js';
import { viewHome } from '../views/home.js';

export async function startGame() {
  clearSlideMem(); // fresh session memory for a new presentation
  state.game = {
    id: crypto.randomUUID(),
    topic: state.topic, concept: state.concept, level: state.level,
    settings: state.settings,
    slideNumber: 1,
    history: [],        // compressed memory sent to the AI
    answers: [],        // full per-slide record for stats
    prefetch: null,     // option index -> promise of the next slide
    startTime: Date.now(),
    finished: false
  };
  $app.innerHTML = loadingHTML('The AI is sketching slide 1…');
  try {
    const slide = await requestSlide(null);
    showSlide(slide);
  } catch (e) { gameError(e, () => startGame()); }
}

function requestSlide(branch, slideNumber) {
  const g = state.game;
  return API.post('/api/ai/slide', {
    gameId: g.id, topic: g.topic, concept: g.concept, level: g.level,
    settings: g.settings,
    slideNumber: slideNumber || g.slideNumber,
    totalSlides: g.settings.totalSlides,
    history: branch ? [...g.history, branch.historyEntry] : g.history,
    branch: branch ? { chosenText: branch.chosenText, correct: branch.correct, misconception: branch.misconception } : null
  });
}

function gameError(e, retry) {
  $app.innerHTML = `<div class="card"><p>😖 The AI pencil broke: ${esc(e.message)}</p>
    <div class="slide-actions"><button class="btn" id="ge-home">Quit</button>
    <button class="btn primary" id="ge-retry">Try again</button></div></div>`;
  document.getElementById('ge-home').addEventListener('click', () => { state.game = null; viewHome(); });
  document.getElementById('ge-retry').addEventListener('click', retry);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function inferEraHint(text) {
  const t = String(text || '').toLowerCase();
  if (/future|futur|2050|2060|2070|2080|2090|2100|tomorrow|next decade|next century/.test(t)) return 'future';
  if (/past|ancient|medieval|renaissance|victorian|historical|century ago|1800|1900|retro|old city/.test(t)) return 'past';
  return 'present';
}

function escXmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTimeTravelImageDataUrl(slide, game) {
  const context = [
    game?.topic,
    game?.concept,
    game?.settings?.customInstructions,
    slide?.title,
    slide?.summary,
    slide?.quiz?.question
  ].filter(Boolean).join(' ');
  const era = inferEraHint(context);
  const palette = era === 'future'
    ? { bg: '#e8f3ff', accent: '#5c80bc', ink: '#17324d' }
    : era === 'past'
      ? { bg: '#f7efe1', accent: '#a36a2c', ink: '#3b2611' }
      : { bg: '#edf6ef', accent: '#3f8a58', ink: '#173223' };
  const title = escXmlText(String(slide?.title || game?.concept || 'Time Travel concept').slice(0, 74));
  const promptLine = escXmlText(String(slide?.quiz?.question || '').slice(0, 120));
  const slideNo = Number(game?.slideNumber || 1);
  const seed = hashText(`${context}|${slideNo}`);
  const h1 = 130 + (seed % 180);
  const h2 = 160 + ((seed >> 3) % 220);
  const h3 = 140 + ((seed >> 5) % 200);
  const c1 = 700 - ((seed >> 2) % 100);
  const c2 = 690 - ((seed >> 4) % 100);
    const variant = seed % 3;
    const scene = variant === 0
     ? `<circle cx="180" cy="390" r="42" fill="${palette.accent}" opacity="0.35"/>
       <circle cx="270" cy="360" r="26" fill="${palette.accent}" opacity="0.2"/>
       <path d="M120 830 L260 690 L380 830" />`
     : variant === 1
      ? `<path d="M120 380 L420 300 L760 430" />
        <path d="M120 430 L420 350 L760 480" opacity="0.7"/>
        <rect x="760" y="300" width="110" height="80" rx="10" fill="${palette.accent}" opacity="0.25"/>`
      : `<rect x="120" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>
        <rect x="235" y="360" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.2"/>
        <rect x="350" y="330" width="90" height="90" rx="8" fill="${palette.accent}" opacity="0.26"/>`;
  const eraLabel = era.toUpperCase();
  const nanoLabel = 'NANO BANANA STYLE';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect x="56" y="56" width="912" height="912" rx="28" fill="none" stroke="${palette.accent}" stroke-width="10"/>
  <text x="84" y="118" font-family="Georgia, serif" font-size="38" fill="${palette.ink}">${nanoLabel}</text>
  <text x="84" y="168" font-family="Georgia, serif" font-size="36" fill="${palette.ink}">${eraLabel} SCENE - SLIDE ${slideNo}</text>
  <text x="84" y="226" font-family="Georgia, serif" font-size="32" fill="${palette.ink}">${title}</text>
  <text x="84" y="278" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${promptLine}</text>
  <g stroke="${palette.ink}" stroke-width="7" fill="none" opacity="0.85">${scene}</g>
  <g stroke="${palette.ink}" stroke-width="8" fill="none" opacity="0.9">
    <path d="M110 ${c1} C 250 ${c1 - 120}, 380 ${c1 - 110}, 520 ${c1}"/>
    <path d="M500 ${c2} C 640 ${c2 - 120}, 760 ${c2 - 110}, 900 ${c2}"/>
    <rect x="180" y="${860 - h1}" width="170" height="${h1}" rx="8" fill="${palette.accent}" opacity="0.2"/>
    <rect x="390" y="${860 - h2}" width="220" height="${h2}" rx="8" fill="${palette.accent}" opacity="0.16"/>
    <rect x="660" y="${860 - h3}" width="170" height="${h3}" rx="8" fill="${palette.accent}" opacity="0.2"/>
  </g>
</svg>`;
  return { era, url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

function enforceGraphOnlyClient(slide, game) {
  if (game?.settings?.imageDensity !== 'text-only') return slide;
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  slide.components = comps.filter(c => !['svg', 'image', 'latex', 'code', 'table'].includes(c?.type));
  return slide;
}

function showSlide(slide) {
  const g = state.game;
  window.scrollTo(0, 0); // start each slide at the top so the user reads top-to-bottom
  slide = enforceGraphOnlyClient(slide, g);
  // shuffle option order so the correct answer isn't always in the same slot;
  // done once here, before both rendering and prefetch, so indices stay aligned
  if (slide.quiz && Array.isArray(slide.quiz.options)) shuffleInPlace(slide.quiz.options);
  g.current = slide;
  const total = g.settings.totalSlides;
  const pct = Math.round(100 * (g.slideNumber - 1) / total);

  $app.innerHTML = `
    <div class="slide-shell">
      <div class="progress-row">
        <span>Slide ${g.slideNumber}/${total}</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span id="game-timer">0:00</span>
      </div>
      <div class="slide">
        <h2>${esc(slide.title)}</h2>
        ${renderComponents(slide.components)}
        <div class="quiz-box">
          <p class="quiz-q">🤔 ${esc(slide.quiz.question)}</p>
          <div class="quiz-options">
            ${slide.quiz.options.map((o, i) => `<button class="quiz-opt" data-i="${i}">${'ABCD'[i] || '•'})&nbsp; ${esc(o.text)}</button>`).join('')}
          </div>
          <div id="quiz-feedback"></div>
        </div>
        <div class="slide-actions" id="slide-actions"></div>
      </div>
    </div>`;

  startTimerDisplay();

  // ---- prefetch: generate the next slide for EVERY option now, in the background,
  // so the moment the learner picks one it is already loaded (no wait, no spinner) ----
  g.prefetch = null;
  g.prefetchReady = {}; // idx -> resolved slide, for instant display without a loading flash
  if (g.slideNumber < g.settings.totalSlides) {
    g.prefetch = slide.quiz.options.map((o, i) => {
      const branch = branchFor(slide, o);
      const cached = memGetSlide(g.id, g.slideNumber + 1, branch.chosenText);
      const promise = cached ? Promise.resolve(cached) : requestSlide(branch, g.slideNumber + 1);
      // remember resolved value + store in browser memory so re-picks/reloads reuse it
      promise.then(s => { g.prefetchReady[i] = s; memPutSlide(g.id, g.slideNumber + 1, branch.chosenText, s); }).catch(() => { });
      return promise;
    });
  }

  $app.querySelectorAll('.quiz-opt').forEach(btn =>
    btn.addEventListener('click', () => answer(parseInt(btn.dataset.i, 10))));
}

function summarizeSlideVisuals(slide) {
  const comps = Array.isArray(slide?.components) ? slide.components : [];
  const toText = (v) => String(v || '').trim();
  return comps
    .filter(c => ['table', 'svg', 'image', 'latex', 'code'].includes(c?.type))
    .map((c) => {
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

function branchFor(slide, option) {
  const visualRefs = summarizeSlideVisuals(slide);
  return {
    chosenText: option.text,
    correct: !!option.correct,
    misconception: option.misconception || '',
    historyEntry: {
      title: slide.title, summary: slide.summary,
      question: slide.quiz.question, chosen: option.text, correct: !!option.correct,
      visualRefs
    }
  };
}

function answer(idx) {
  const g = state.game;
  const slide = g.current;
  const opt = slide.quiz.options[idx];
  const correctIdx = slide.quiz.options.findIndex(o => o.correct);

  $app.querySelectorAll('.quiz-opt').forEach((b, i) => {
    b.disabled = true;
    if (i === idx) b.classList.add(opt.correct ? 'picked-correct' : 'picked-wrong');
    else if (i === correctIdx && !opt.correct) b.classList.add('reveal-correct');
  });

  document.getElementById('quiz-feedback').innerHTML = opt.correct
    ? `<div class="quiz-feedback good"><b>✔ Correct!</b> ${esc(opt.explanation || '')}${g.slideNumber < g.settings.totalSlides ? ' The next slide digs deeper.' : ''}</div>`
    : `<div class="quiz-feedback bad"><b>✘ Not quite.</b> ${esc(opt.explanation || '')}${g.slideNumber < g.settings.totalSlides ? ' The next slide takes a detour to fix this idea.' : ''}</div>`;

  const branch = branchFor(slide, opt);
  g.answers.push({
    slide: g.slideNumber, title: slide.title, question: slide.quiz.question,
    chosen: opt.text, correct: !!opt.correct, misconception: opt.misconception || ''
  });
  g.history.push(branch.historyEntry);

  const actions = document.getElementById('slide-actions');
  if (g.slideNumber >= g.settings.totalSlides) {
    actions.innerHTML = `<button class="btn primary" id="next-btn">See my results 🏁</button>`;
    document.getElementById('next-btn').addEventListener('click', finishGame);
  } else {
    actions.innerHTML = `<button class="btn primary" id="next-btn">Next slide →</button>`;
    document.getElementById('next-btn').addEventListener('click', () => advance(idx, branch));
  }
}

async function advance(idx, branch) {
  const g = state.game;
  try {
    // If this branch's slide already finished loading in the background, show it
    // instantly with no spinner; otherwise show the loader only while we wait.
    let slide = (g.prefetchReady && g.prefetchReady[idx]) || null;
    if (!slide) {
      window.scrollTo(0, 0);
      $app.innerHTML = loadingHTML('Turning the page…');
      try {
        slide = await g.prefetch[idx];
      } catch {
        slide = memGetSlide(g.id, g.slideNumber + 1, branch.chosenText)
          || await requestSlide(branch, g.slideNumber + 1);
      }
    }
    memPutSlide(g.id, g.slideNumber + 1, branch.chosenText, slide);
    g.slideNumber++;
    showSlide(slide); // scrolls to top itself
  } catch (e) { gameError(e, () => advance(idx, branch)); }
}

let timerInterval = null;
function startTimerDisplay() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const el = document.getElementById('game-timer');
    if (!el || !state.game) { clearInterval(timerInterval); return; }
    const s = Math.floor((Date.now() - state.game.startTime) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

/* ---------------- final stats slide ---------------- */
async function finishGame() {
  const g = state.game;
  g.finished = true;
  clearInterval(timerInterval);
  clearSlideMem(g.id); // presentation done → dump its cached branch slides
  const durationSec = Math.floor((Date.now() - g.startTime) / 1000);
  const correct = g.answers.filter(a => a.correct).length;
  const total = g.answers.length;
  const questionSummary = g.answers.map(a => a.question).filter(Boolean).join(', ');
  const answerSummary = g.answers.map(a => a.chosen).filter(Boolean).join(', ');

  $app.innerHTML = loadingHTML('Grading your sketchbook…');

  let rec = null;
  let gradingNote = '';
  try {
    rec = await withTimeout(API.post('/api/ai/recommend', {
      topic: g.topic, concept: g.concept, level: g.level,
      correct, total, durationSec, slides: g.answers
    }), 12000, 'Coach grading took too long. Showing report without coach notes.');
  } catch (e) {
    gradingNote = `<p class="form-error">${esc(e.message || 'Coach grading was unavailable. Showing report without coach notes.')}</p>`;
  }

  let saveNote = '';
  let saved = null;
  try {
    saved = await withTimeout(API.post('/api/games', {
      topic: g.topic, concept: g.concept, level: g.level, settings: g.settings,
      slides: g.answers, correct, total, durationSec, recommendations: rec,
      questionSummary,
      answerSummary,
      aiNotes: rec?.aiNotes || []
    }), 12000, 'Saving took too long. Report is visible, but this run may not be in history yet.');
  } catch (e) { saveNote = `<p class="form-error">Could not save this run: ${esc(e.message)}</p>`; }

  const mins = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`;
  const shareUrl = saved?.shareUrl || '';
  $app.innerHTML = `
    <div class="slide-shell">
      <div class="slide">
        <h2>🏁 ${esc(g.concept)} — your results</h2>
        <p><b>${esc(API.user.username)}</b> · ${esc(g.level)} · ${esc(g.topic)}</p>
        <p class="muted-line">Completed on ${esc(new Date().toLocaleDateString())} at ${esc(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</p>
        <div class="stat-row">
          <div class="stat-tile"><div class="big">${correct}/${total}</div>correct</div>
          <div class="stat-tile"><div class="big">${total ? Math.round(100 * correct / total) : 0}%</div>score</div>
          <div class="stat-tile"><div class="big">${mins}</div>time</div>
        </div>
        ${shareUrl ? `<div class="share-box"><div><b>Shareable report</b><br><a href="${esc(shareUrl)}" target="_blank" rel="noreferrer">${esc(shareUrl)}</a></div><button class="btn small" id="copy-share">Copy link</button></div>` : ''}
        ${Array.isArray(rec?.aiNotes) && rec.aiNotes.length ? `<div class="quiz-feedback" style="margin-top:14px"><b>AI notes</b><ul style="padding-left:22px;margin-top:6px">${rec.aiNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <div class="table-wrap"><table class="sketch">
          <tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th><th>AI notes</th></tr>
          ${g.answers.map(a => `<tr><td>${a.slide}</td><td>${esc(a.question)}</td><td>${esc(a.chosen)}</td><td>${a.correct ? '✔' : '✘'}</td><td class="clamped">${esc(Array.isArray(rec?.aiNotes) ? rec.aiNotes.join(' · ') : '')}</td></tr>`).join('')}
        </table></div>
        ${rec ? `
          <div class="quiz-feedback" style="margin-top:18px">
            <p><b>Coach says:</b> ${esc(rec.summary || '')}</p>
            <ul style="padding-left:22px;margin-top:6px">${(rec.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            ${(rec.nextConcepts || []).length ? `<p style="margin-top:6px"><b>Try next:</b> ${rec.nextConcepts.map(n => `${esc(n.name)} (${esc(n.level)})`).join(' · ')}</p>` : ''}
          </div>` : ''}
        ${gradingNote}
        ${saveNote}
        <div class="slide-actions">
          <button class="btn" id="fin-stats">My stats</button>
          <button class="btn blue" id="fin-again">Same concept again</button>
          <button class="btn primary" id="fin-new">New topic</button>
        </div>
      </div>
    </div>`;
  state.game = null;
  document.getElementById('fin-stats').addEventListener('click', () => nav('stats'));
  document.getElementById('fin-again').addEventListener('click', () => viewSettings());
  document.getElementById('fin-new').addEventListener('click', () => nav('home'));
}
