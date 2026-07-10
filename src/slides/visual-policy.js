/* Slide visual-policy engine: decides and enforces which visual a slide carries,
 * prevents repeats across a lesson, builds image prompts, and summarizes the
 * learner's status/profile for adaptive decisions. */
const { componentVisualSignature } = require('./sanitize');
const { makeFallbackProofLatex } = require('./fallback');

function enforceSlideVisualPolicy(slide, history = [], slideNumber = 1) {
  const visualTypes = new Set(['table', 'image', 'latex', 'code', 'svg']);
  const normalizeSig = (value) => String(value || '')
    .toLowerCase()
    .replace(/slide\s*\d+/g, 'slide')
    .replace(/data-slide\s*=\s*['"]?\d+['"]?/g, 'data-slide')
    .replace(/\s+/g, ' ')
    .trim();
  const previous = new Set(
    (Array.isArray(history) ? history : [])
      .flatMap(h => Array.isArray(h?.visualRefs) ? h.visualRefs : [])
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const previousCanonical = new Set([...previous].map(normalizeSig).filter(Boolean));
  const previousTypes = new Set(
    [...previous]
      .map(v => String(v).split(':')[0])
      .filter(Boolean)
  );

  const components = Array.isArray(slide.components) ? slide.components : [];
  const visualIndexes = components
    .map((c, idx) => ({ c, idx, sig: componentVisualSignature(c) }))
    .filter(x => visualTypes.has(x.c?.type));

  if (visualIndexes.length > 1) {
    const preferred =
      visualIndexes.find(v => v.sig && !previousCanonical.has(normalizeSig(v.sig))) ||
      visualIndexes.find(v => !previousTypes.has(String(v.c?.type || '').toLowerCase())) ||
      visualIndexes[0];
    slide.components = components.filter((_, idx) => !visualIndexes.some(v => v.idx === idx) || idx === preferred.idx);
  }

  const oneVisual = (slide.components || []).find(c => visualTypes.has(c?.type));
  if (!oneVisual) return;

  const sig = componentVisualSignature(oneVisual).toLowerCase();
  const sigCanonical = normalizeSig(sig);
  const repeatProneType = ['table', 'svg'].includes(String(oneVisual.type || '').toLowerCase())
    && previousTypes.has(String(oneVisual.type || '').toLowerCase());
  if (!sig || (!previousCanonical.has(sigCanonical) && !repeatProneType)) return;

  const titleSeed = String(slide.title || 'this concept').trim();
  const quizSeed = String(slide?.quiz?.question || '').trim().slice(0, 90);

  // Ensure uniqueness when a repeated visual slips through by adjusting the component content.
  if (oneVisual.type === 'table' && Array.isArray(oneVisual.rows)) {
    const width = 2;
    const forcedRow = [
      `Slide ${slideNumber}: ${titleSeed}`,
      quizSeed || 'Different perspective'
    ].slice(0, width);
    if (!Array.isArray(oneVisual.rows)) oneVisual.rows = [];
    oneVisual.rows = [forcedRow, ...oneVisual.rows].slice(0, 8);
    if (!Array.isArray(oneVisual.headers) || !oneVisual.headers.length) {
      oneVisual.headers = ['Main idea', 'Different perspective'].slice(0, width);
    } else {
      oneVisual.headers = oneVisual.headers.slice(0, width);
    }
    oneVisual.caption = `Slide ${slideNumber}: ${String(oneVisual.caption || 'comparison table').trim()}`;
    return;
  }
  if (oneVisual.type === 'image') {
    oneVisual.caption = `Slide ${slideNumber}: ${String(oneVisual.caption || oneVisual.alt || 'concept illustration').trim()}`;
    if (oneVisual.prompt) oneVisual.prompt = `${String(oneVisual.prompt).trim()} Distinct slide perspective ${slideNumber}.`;
    return;
  }
  if (oneVisual.type === 'latex') {
    oneVisual.caption = `Slide ${slideNumber}: ${String(oneVisual.caption || 'Formula').trim()}`;
    return;
  }
  if (oneVisual.type === 'code') {
    const base = String(oneVisual.content || '').trim();
    oneVisual.content = `// slide ${slideNumber} variant\n${base}`;
  }
}

function inferTimeEraHint(text = '') {
  const t = String(text || '').toLowerCase();
  if (/future|futur|2050|2060|2070|2080|2090|2100|tomorrow|next decade|next century/.test(t)) return 'future';
  if (/past|ancient|medieval|renaissance|victorian|historical|century ago|1800|1900|retro|old city/.test(t)) return 'past';
  if (/present|today|current|modern|now|contemporary/.test(t)) return 'present';
  return 'present';
}

function buildTimeTravelImagePrompt(slide, context = {}) {
  const texts = (Array.isArray(slide?.components) ? slide.components : [])
    .filter(c => c?.type === 'text')
    .map(c => String(c.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2);
  const narrative = [
    String(slide?.title || '').trim(),
    String(slide?.summary || '').trim(),
    String(slide?.quiz?.question || '').trim(),
    ...texts
  ].filter(Boolean).join(' ');

  const era = inferTimeEraHint(`${context.topic || ''} ${context.concept || ''} ${narrative} ${context.customInstructions || ''}`);
  const eraDirection = era === 'future'
    ? 'FUTURE setting: use plausible futuristic architecture, transport, clothing, interfaces, and infrastructure.'
    : era === 'past'
      ? 'PAST setting: use historically accurate architecture, materials, clothing, tools, transport, and signage.'
      : 'PRESENT setting: use realistic current-day architecture, technology, transport, and public spaces.';

  return [
    'NANO BANANA style educational illustration for a Time Travel learning slide.',
    `Topic: ${context.topic || ''}. Concept: ${context.concept || ''}.`,
    `This is slide ${context.slideNumber || 1} of ${context.totalSlides || '?'}.`,
    `Slide focus: ${narrative.slice(0, 700)}`,
    eraDirection,
    'Make this scene composition clearly different from earlier slides in the same activity.',
    'The scene must directly visualize the concept in this story and support answering the slide quiz.',
    'No anachronisms: all visual details must match the selected time period accurately.',
    'Cinematic but classroom-safe, clear composition, high detail, no text overlays, no logos.'
  ].join(' ');
}

function enforceTimeTravelImagePolicy(slide, context = {}) {
  if (!slide || !Array.isArray(slide.components)) return;
  const visualTypes = new Set(['table', 'svg', 'image', 'latex', 'code']);
  const imagePrompt = buildTimeTravelImagePrompt(slide, context);
  const nonVisual = slide.components.filter(c => !visualTypes.has(c?.type));
  const imageComp = {
    type: 'image',
    prompt: imagePrompt,
    frame: context.slideNumber % 2 === 0 ? 'polaroid' : 'paper',
    caption: `${String((inferTimeEraHint(imagePrompt) || 'present')).toUpperCase()} scene: Slide ${context.slideNumber || 1} - ${String(slide.title || context.concept || 'Time Travel concept').trim()}`
  };

  // Keep exactly one primary visual for Time Travel: the generated image.
  const firstTextIdx = nonVisual.findIndex(c => c?.type === 'text');
  if (firstTextIdx >= 0) {
    nonVisual.splice(firstTextIdx + 1, 0, imageComp);
  } else {
    nonVisual.unshift(imageComp);
  }
  slide.components = nonVisual;
}

function buildGenericImagePrompt(slide, context = {}) {
  const texts = (Array.isArray(slide?.components) ? slide.components : [])
    .filter(c => c?.type === 'text')
    .map(c => String(c.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return [
    'NANO BANANA style educational illustration.',
    `Topic: ${context.topic || ''}. Concept: ${context.concept || ''}.`,
    `Slide ${context.slideNumber || 1} of ${context.totalSlides || '?'}.`,
    `Title: ${String(slide?.title || '').trim()}. Summary: ${String(slide?.summary || '').trim()}.`,
    `Key content: ${texts.slice(0, 600)}`,
    'Make this image unique vs previous slides and directly useful for answering the quiz.',
    'High clarity, no logos, no text overlays.'
  ].join(' ');
}

// Human-readable snapshot of the learner's performance for AI suggestion prompts:
// overall accuracy, weakest and strongest concepts, and the level they play most.
function summarizeLearnerStatus(games = []) {
  const list = Array.isArray(games) ? games.filter(g => g && (g.total || 0) > 0) : [];
  if (!list.length) return 'No games played yet — treat as a fresh learner; keep the first suggestion approachable.';
  let correctSum = 0, totalSum = 0;
  const byConcept = new Map();
  const levelCounts = new Map();
  for (const g of list) {
    const total = Math.max(1, Number(g.total) || 1);
    const correct = Math.max(0, Number(g.correct) || 0);
    correctSum += correct; totalSum += total;
    const key = `${g.topic} / ${g.concept}`.trim();
    const agg = byConcept.get(key) || { correct: 0, total: 0 };
    agg.correct += correct; agg.total += total;
    byConcept.set(key, agg);
    if (g.level) levelCounts.set(g.level, (levelCounts.get(g.level) || 0) + 1);
  }
  const overall = Math.round((correctSum / Math.max(1, totalSum)) * 100);
  const scored = [...byConcept.entries()].map(([k, v]) => ({ k, pct: v.correct / Math.max(1, v.total) }));
  const weak = scored.filter(s => s.pct < 0.6).sort((a, b) => a.pct - b.pct).slice(0, 3).map(s => `${s.k} (${Math.round(s.pct * 100)}%)`);
  const strong = scored.filter(s => s.pct >= 0.8).sort((a, b) => b.pct - a.pct).slice(0, 3).map(s => `${s.k} (${Math.round(s.pct * 100)}%)`);
  const usualLevel = [...levelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
  const lines = [
    `Games played: ${list.length}. Overall accuracy: ${overall}%. Most-played level: ${usualLevel}.`,
    weak.length ? `Weak spots (reinforce these): ${weak.join(', ')}.` : 'No clear weak spots yet.',
    strong.length ? `Strong spots (can build beyond these): ${strong.join(', ')}.` : 'No clearly mastered areas yet.',
    overall < 55 ? 'Guidance: ease difficulty and complexity, lean text-heavier for clarity.'
      : overall > 80 ? 'Guidance: raise the challenge and rigor.'
      : 'Guidance: keep a moderate challenge appropriate to the topic.'
  ];
  return lines.join('\n');
}

// Offline fallback for the "Suggest topic + settings" button: varied every call and
// grounded in the learner's history, so that when no AI provider is reachable the
// button still rotates through diverse, personalized suggestions instead of one fixed topic.
function buildStructuredSuggestFallback(games = [], avoidSet = new Set()) {
  const pool = [
    { prompt: 'Bayes theorem for medical test interpretation', exampleType: 'proof', symbolic: true },
    { prompt: 'Taylor series approximation of sin(x)', exampleType: 'proof', symbolic: true },
    { prompt: 'Dijkstra shortest-path algorithm, step by step', exampleType: 'tree-diagram', symbolic: true },
    { prompt: 'Supply and demand equilibrium with elasticity', exampleType: 'graph-table', symbolic: false },
    { prompt: 'Entropy and information gain in decision trees', exampleType: 'graph-table', symbolic: true },
    { prompt: 'Eigenvalues and eigenvectors, the geometric picture', exampleType: 'worked-example', symbolic: true },
    { prompt: 'The central limit theorem: intuition and proof sketch', exampleType: 'proof', symbolic: true },
    { prompt: 'Gradient descent: the update rule and why it converges', exampleType: 'worked-example', symbolic: true },
    { prompt: 'Big-O analysis of common sorting algorithms', exampleType: 'graph-table', symbolic: true },
    { prompt: 'Causes and consequences of the Industrial Revolution', exampleType: 'outline', symbolic: false },
    { prompt: 'How mRNA vaccines train the immune system', exampleType: 'outline', symbolic: false },
    { prompt: 'Photosynthesis: the light and dark reactions', exampleType: 'outline', symbolic: false },
    { prompt: "Newton's laws applied to orbital motion", exampleType: 'worked-example', symbolic: true },
    { prompt: 'Compound interest and the time value of money', exampleType: 'worked-example', symbolic: true }
  ];

  // Reinforce weak spots first: pull concepts the learner is scoring low on.
  const byConcept = new Map();
  for (const g of (Array.isArray(games) ? games : [])) {
    if (!g || !(Number(g.total) > 0)) continue;
    const key = `${g.topic} / ${g.concept}`.trim();
    const a = byConcept.get(key) || { c: 0, t: 0, topic: g.topic, concept: g.concept };
    a.c += Number(g.correct) || 0; a.t += Number(g.total) || 0;
    byConcept.set(key, a);
  }
  const weakFirst = [];
  for (const [, v] of byConcept) {
    if (v.t && v.c / v.t < 0.6) {
      weakFirst.push({ prompt: `${v.concept || v.topic}: targeted practice to fix a weak spot`, exampleType: 'worked-example', symbolic: /math|calc|algebra|probab|statistic|physics|algorithm|proof/i.test(`${v.topic} ${v.concept}`) });
    }
  }

  const candidates = [...weakFirst, ...pool].filter(c => c.prompt && !avoidSet.has(c.prompt.toLowerCase()));
  const list = candidates.length ? candidates : pool;
  // Bias toward the front (weak spots) but keep it varied across clicks.
  const span = Math.min(list.length, weakFirst.length ? weakFirst.length + 4 : list.length);
  const chosen = list[Math.floor(Math.random() * span)];

  const profile = summarizeLearnerVisualProfile(games);
  const level = profile.avgScore < 0.55 ? 'Lower Intermediate' : profile.avgScore > 0.82 ? 'Advanced' : 'Upper Intermediate';
  const complexity = profile.avgScore < 0.55 ? 'simple' : profile.avgScore > 0.82 ? 'scholarly' : 'standard';
  return {
    prompt: chosen.prompt,
    exampleType: chosen.exampleType || 'worked-example',
    level,
    tone: 'Friendly lecture',
    complexity,
    paragraphLength: 'medium',
    imageDensity: chosen.symbolic ? 'mostly-text' : 'balanced',
    totalSlides: 8,
    continuation: 'related-topics',
    alternateVisualMath: !!chosen.symbolic
  };
}

function summarizeLearnerVisualProfile(games = []) {
  const recent = Array.isArray(games) ? games.slice(-12) : [];
  if (!recent.length) return { avgScore: 0.65, lowConfidence: false, note: 'no prior history available' };
  const ratios = recent
    .map(g => {
      const total = Math.max(1, Number(g?.total) || 1);
      const correct = Math.max(0, Number(g?.correct) || 0);
      return correct / total;
    })
    .filter(Number.isFinite);
  const avgScore = ratios.length ? (ratios.reduce((a, b) => a + b, 0) / ratios.length) : 0.65;
  const lowConfidence = avgScore < 0.58;
  return {
    avgScore,
    lowConfidence,
    note: lowConfidence
      ? 'recent quizzes show lower confidence; add more concrete visuals for comprehension when topic fit is high'
      : 'recent quizzes show stable understanding; use visuals only when they add explanatory value'
  };
}

function decideAdaptiveVisualMode({ topic = '', concept = '', settings = {}, proofMode = false, isTimeTravelActivity = false, stemFocus = false, learnerProfile = null } = {}) {
  const density = ['text-only', 'mostly-text', 'balanced', 'mostly-visual'].includes(settings.imageDensity)
    ? settings.imageDensity
    : 'balanced';
  const text = `${topic} ${concept} ${settings.customInstructions || ''}`.toLowerCase();
  const technical = stemFocus || /algorithm|proof|calculus|algebra|statistics|equation|derivative|integral|linear algebra|coding|programming|compiler|data structure|cryptography/.test(text);
  const illustrative = /history|biology|anatomy|brain|cell|ecosystem|geography|culture|art|architecture|medicine|human body|botany|zoology|timeline|civilization/.test(text);
  const lowConfidence = !!learnerProfile?.lowConfidence;

  if (density === 'text-only') {
    return {
      density,
      allowImages: false,
      preferredVisual: proofMode ? 'latex' : 'none',
      targetImageSlots: 0,
      promptRule: 'Learner selected text-only output; do not include image or svg components.'
    };
  }

  if (proofMode || technical) {
    return {
      density: density === 'mostly-visual' ? 'balanced' : density,
      allowImages: false,
      preferredVisual: 'latex/table/code',
      targetImageSlots: 0,
      promptRule: 'This topic is technical/proof-heavy. Prefer text + latex/code/table. Do not use image components unless explicitly necessary (normally zero images).'
    };
  }

  if (isTimeTravelActivity || illustrative) {
    const target = density === 'mostly-visual' ? 1 : (lowConfidence ? 1 : 1);
    return {
      density,
      allowImages: true,
      preferredVisual: 'image',
      targetImageSlots: target,
      promptRule: `This topic is illustration-friendly. Include ${target} meaningful image component that explains the concept (not decoration), and keep the prose connected to it.`
    };
  }

  if (density === 'mostly-visual') {
    return {
      density,
      allowImages: true,
      preferredVisual: 'image',
      targetImageSlots: 1,
      promptRule: 'Learner requested a visual-heavy slide. Include one concept-explaining image component plus explanatory text.'
    };
  }

  return {
    density,
    allowImages: false,
    preferredVisual: 'table',
    targetImageSlots: 0,
    promptRule: 'Use text-first explanation. Use non-image visuals only when they improve understanding.'
  };
}

function enforceLatexNarrativeCadence(slide, context = {}) {
  if (!slide || !Array.isArray(slide.components)) return;

  const proofMode = !!context.proofMode;
  const stemFocus = !!context.stemFocus;
  const slideNumber = Math.max(1, Number(context.slideNumber) || 1);
  const history = Array.isArray(context.history) ? context.history : [];

  const normalize = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const recentLatexRefs = history
    .slice(-4)
    .flatMap(h => Array.isArray(h?.visualRefs) ? h.visualRefs : [])
    .filter(v => String(v || '').toLowerCase().startsWith('latex:'))
    .map(v => normalize(v));

  const extractLatexBody = (ref) => {
    const s = String(ref || '');
    const i = s.indexOf('::');
    if (i < 0) return '';
    return normalize(s.slice(i + 2));
  };
  const recentLatexBodies = recentLatexRefs.map(extractLatexBody).filter(Boolean);

  const textCount = slide.components.filter(c => c?.type === 'text' && String(c.content || '').trim()).length;
  let latexComps = slide.components.filter(c => c?.type === 'latex');
  if (!latexComps.length) return;

  for (const comp of latexComps) {
    const content = String(comp.content || '');
    comp.content = content
      .replace(/\\text\{continue from the previous line\}/gi, '\\text{cont.}')
      .replace(/\\text\{repair the missing step\}/gi, '\\text{fix gap}')
      .replace(/\\text\{then deepen the result\}/gi, '\\text{extend}')
      .replace(/\\text\{then resume the derivation\}/gi, '\\text{resume}');
    const shortCaption = String(comp.caption || '').replace(/^\s*slide\s*\d+\s*:\s*/i, '').trim();
    comp.caption = shortCaption;
  }

  const firstLatex = latexComps[0];
  const latexCanonical = normalize(String(firstLatex?.content || '')).replace(/\\(begin|end)\{aligned\}/g, '').replace(/[{}]/g, '');
  const latexSig = latexCanonical.slice(0, 140);
  const repeatsRecentLatex = !!(latexSig && recentLatexBodies.some(body => body.includes(latexSig) || latexSig.includes(body.slice(0, 80))));

  const textOnlyConsolidation = (!proofMode && stemFocus && slideNumber % 3 === 0)
    || (proofMode && slideNumber % 4 === 0 && textCount >= 2);

  if (textOnlyConsolidation) {
    slide.components = slide.components.filter(c => c?.type !== 'latex');
    return;
  }

  if (repeatsRecentLatex) {
    if (proofMode) {
      firstLatex.content = makeFallbackProofLatex({
        topic: context.topic || '',
        concept: context.concept || '',
        slideNumber,
        branch: context.branch || null
      });
      firstLatex.caption = `Step ${slideNumber}`;
      slide.components = slide.components.filter((c, idx) => c?.type !== 'latex' || idx === slide.components.indexOf(firstLatex));
      return;
    }
    slide.components = slide.components.filter(c => c?.type !== 'latex');
    return;
  }

  if (!proofMode && latexComps.length > 1) {
    const keep = slide.components.indexOf(firstLatex);
    slide.components = slide.components.filter((c, idx) => c?.type !== 'latex' || idx === keep);
  }
}

function enforceVisualCyclePolicy(slide, context = {}) {
  if (!slide || !Array.isArray(slide.components)) return;
  if (context.imageDensity === 'text-only') return;
}

function escXml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fallbackImageDataUrl(prompt = '', caption = '') {
  const era = inferTimeEraHint(`${prompt} ${caption}`);
  const palette = era === 'future'
    ? { bg: '#e8f3ff', accent: '#5c80bc', ink: '#17324d' }
    : era === 'past'
      ? { bg: '#f7efe1', accent: '#a36a2c', ink: '#3b2611' }
      : { bg: '#edf6ef', accent: '#3f8a58', ink: '#173223' };
  const eraLabel = era.toUpperCase();
  const a = escXml(String(caption || 'Time Travel scene').slice(0, 72));
  const b = escXml(String(prompt).replace(/\s+/g, ' ').trim().slice(0, 96));
  const c = escXml(String(prompt).replace(/\s+/g, ' ').trim().slice(96, 190));
  let hash = 0;
  const seedSource = `${prompt}|${caption}`;
  for (let i = 0; i < seedSource.length; i++) hash = ((hash << 5) - hash + seedSource.charCodeAt(i)) | 0;
  hash = Math.abs(hash);
  const h1 = 130 + (hash % 180);
  const h2 = 160 + ((hash >> 3) % 220);
  const h3 = 140 + ((hash >> 5) % 200);
  const c1 = 700 - ((hash >> 2) % 100);
  const c2 = 690 - ((hash >> 4) % 100);
    const variant = hash % 3;
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="${a}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <rect x="56" y="56" width="912" height="912" rx="28" fill="none" stroke="${palette.accent}" stroke-width="10"/>
  <text x="84" y="130" font-family="Georgia, serif" font-size="42" fill="${palette.ink}">NANO BANANA ${eraLabel} SCENE</text>
  <text x="84" y="196" font-family="Georgia, serif" font-size="34" fill="${palette.ink}">${a}</text>
  <text x="84" y="252" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${b}</text>
  <text x="84" y="290" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${c}</text>
  <g stroke="${palette.ink}" stroke-width="7" fill="none" opacity="0.85">${scene}</g>
  <g stroke="${palette.ink}" stroke-width="8" fill="none" opacity="0.9">
    <path d="M110 ${c1} C 250 ${c1 - 120}, 380 ${c1 - 110}, 520 ${c1}"/>
    <path d="M500 ${c2} C 640 ${c2 - 120}, 760 ${c2 - 110}, 900 ${c2}"/>
    <rect x="180" y="${860 - h1}" width="170" height="${h1}" rx="8" fill="${palette.accent}" opacity="0.2"/>
    <rect x="390" y="${860 - h2}" width="220" height="${h2}" rx="8" fill="${palette.accent}" opacity="0.16"/>
    <rect x="660" y="${860 - h3}" width="170" height="${h3}" rx="8" fill="${palette.accent}" opacity="0.2"/>
  </g>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = {
  enforceSlideVisualPolicy,
  enforceLatexNarrativeCadence,
  enforceVisualCyclePolicy,
  decideAdaptiveVisualMode,
  summarizeLearnerStatus,
  summarizeLearnerVisualProfile,
  inferTimeEraHint,
  buildTimeTravelImagePrompt,
  enforceTimeTravelImagePolicy,
  buildGenericImagePrompt,
  buildStructuredSuggestFallback,
  escXml,
  fallbackImageDataUrl
};
