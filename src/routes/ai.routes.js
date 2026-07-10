/* All AI-backed routes (learning path, topics, suggestions, slides, coaching)
 * plus /api/config, and the background cache-refresh helpers they use. */
const express = require('express');
const crypto = require('crypto');
const {
  GLOBAL_TREND_SEEDS, DEFAULT_SUGGESTION_PAIR, DEFAULT_HOME_TOPIC_POOL,
  geminiEnabled, deepseekEnabled, imageEnabled, claudeSvgEnabled
} = require('../config');
const { readJSON, saveGeneration } = require('../db/persistence');
const { recentUserGames } = require('../db/games');
const {
  isValidSuggestion,
  readSuggestedStore, writeSuggestedStore, readHomeTopicsStore, writeHomeTopicsStore,
  normalizeTopicPool, rotatePickFromList, randomPickSuggestionNoRepeat,
  makeFallbackPair, normalizeSuggestion
} = require('../db/caches');
const { auth } = require('../auth');
const { generateText, generateStructured, fillImages } = require('../ai/providers');

const { buildLearningPathPrompt } = require('../ai/prompts/learning-path');
const { buildHomeTopicPoolPrompt } = require('../ai/prompts/home-topics');
const { buildSuggestedTopicPrompt } = require('../ai/prompts/suggested-topic');
const { buildTimeTravelHeadlinePrompt } = require('../ai/prompts/time-travel-headline');
const { buildStructuredSuggestPrompt } = require('../ai/prompts/structured-suggest');
const { buildLevelRefreshPrompt } = require('../ai/prompts/level-refresh');
const { buildRecommendPrompt, buildCoachChatSystem } = require('../ai/prompts/coach');
const {
  buildSlideSystemPrompt, buildSlideHistoryText, buildSlideBranchText, buildSlideUserPrompt
} = require('../ai/prompts/slide');

const { sanitizeComponents } = require('../slides/sanitize');
const {
  makeFallbackLearningPath, makeFallbackLevelConcepts, makeFallbackSlide,
  makeFallbackRecommendation, makeFallbackCoachReply, makeFallbackProofLatex
} = require('../slides/fallback');
const {
  enforceSlideVisualPolicy, enforceLatexNarrativeCadence, decideAdaptiveVisualMode,
  summarizeLearnerStatus, summarizeLearnerVisualProfile,
  enforceTimeTravelImagePolicy, buildGenericImagePrompt, buildStructuredSuggestFallback
} = require('../slides/visual-policy');

const router = express.Router();

// ---------- AI: learning path ----------
router.post('/api/ai/path', auth, async (req, res) => {
  const { topic, guidance, levels, fromHistory, freshSeed } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const allLevels = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
  const wanted = Array.isArray(levels) && levels.length ? allLevels.filter(l => levels.includes(l)) : allLevels;

  // When refreshing from history, feed the learner's recent activity so the path adapts.
  let historyLine = '';
  if (fromHistory) {
    const games = readJSON('games.json', []).filter(g => g.username === req.user.username).slice(-15);
    if (games.length) {
      historyLine = '\nThe learner has recently studied (adapt the path to build on strengths and shore up weak spots, and suggest fresh concepts they have NOT yet seen):\n' +
        games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): scored ${g.correct}/${g.total}`).join('\n');
    } else {
      historyLine = '\nThe learner has no history yet — give a well-rounded introductory path.';
    }
  }

  try {
    if (!geminiEnabled && !deepseekEnabled) {
      const fallback = makeFallbackLearningPath(topic, wanted);
      return res.json({ ...fallback, fallback: true });
    }
    const lp = buildLearningPathPrompt({ wanted, topic, guidance, historyLine, freshSeed });
    const result = await generateStructured([
      { role: 'system', content: lp.system },
      { role: 'user', content: lp.user }
    ], { temperature: fromHistory || freshSeed ? 0.95 : 0.7, maxTokens: 4096 });
    const id = crypto.randomUUID();
    saveGeneration('paths', id, { username: req.user.username, topic, guidance, result, createdAt: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

async function generateHomeTopicPoolForUser(username, { avoid = [], triggerTopic = '', poolSize = 24 } = {}) {
  const games = await recentUserGames(username, 30);
  const learned = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-20);
  const avoidList = Array.isArray(avoid) ? avoid.map(String).filter(Boolean).slice(0, 50) : [];
  const wantedPool = Math.min(36, Math.max(18, parseInt(poolSize, 10) || 24));

  const htp = buildHomeTopicPoolPrompt({ wantedPool, triggerTopic, learned, trendSeeds: GLOBAL_TREND_SEEDS, avoidList });
  const result = await generateStructured([
    { role: 'system', content: htp.system },
    { role: 'user', content: htp.user }
  ], { temperature: 0.74, maxTokens: 2200 });

  return normalizeTopicPool((result.topics || []).map(t => t.name), DEFAULT_HOME_TOPIC_POOL);
}

async function refreshHomeTopicPoolForUser(username, options = {}, store = null) {
  const activeStore = store || await readHomeTopicsStore();
  const pool = await generateHomeTopicPoolForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    topics: pool,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null
  };
  await writeHomeTopicsStore(activeStore);
  saveGeneration('home-topics', crypto.randomUUID(), { username, options, topics: pool, createdAt: new Date().toISOString() });
  return pool;
}

function queueHomeTopicPoolRefresh(username, options = {}) {
  setTimeout(() => {
    refreshHomeTopicPoolForUser(username, options).catch(e => {
      console.error('Background home-topic refresh failed:', e.message);
    });
  }, 0);
}

// ---------- AI: topic suggestions for the home chips (fast cache + rotating window) ----------
router.post('/api/ai/topics', auth, async (req, res) => {
  const { count = 12, avoid = [], refresh = false, triggerTopic = '' } = req.body || {};
  const wanted = Math.min(20, Math.max(6, parseInt(count, 10) || 12));
  const avoidSet = new Set((Array.isArray(avoid) ? avoid : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readHomeTopicsStore();

  if (refresh) {
    try {
      const pool = await refreshHomeTopicPoolForUser(req.user.username, { avoid, triggerTopic, poolSize: 24 }, store);
      const entry = store.users[req.user.username] || { topics: pool, cursor: 0 };
      const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
      entry.cursor = rotated.nextCursor;
      store.users[req.user.username] = entry;
      await writeHomeTopicsStore(store);
      return res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: false, poolUpdated: true });
    } catch {
      const rotated = rotatePickFromList(store.defaults || DEFAULT_HOME_TOPIC_POOL, wanted, avoidSet, 0);
      return res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: true, poolUpdated: false });
    }
  }

  const userEntry = store.users[req.user.username] || null;
  const pool = normalizeTopicPool(userEntry?.topics, normalizeTopicPool(store.defaults, DEFAULT_HOME_TOPIC_POOL));
  const hasUserPool = !!(userEntry && Array.isArray(userEntry.topics) && userEntry.topics.length);

  if (!hasUserPool) {
    store.users[req.user.username] = {
      topics: pool,
      cursor: 0,
      updatedAt: new Date().toISOString(),
      triggerTopic: null
    };
    await writeHomeTopicsStore(store);
    queueHomeTopicPoolRefresh(req.user.username, { avoid, triggerTopic, poolSize: 24 });
  }

  const entry = store.users[req.user.username] || { topics: pool, cursor: 0 };
  const rotated = rotatePickFromList(entry.topics || pool, wanted, avoidSet, Number.isInteger(entry.cursor) ? entry.cursor : 0);
  entry.cursor = rotated.nextCursor;
  store.users[req.user.username] = entry;
  await writeHomeTopicsStore(store);
  res.json({ topics: rotated.items.map(name => ({ name, why: '' })), cached: true, poolUpdated: false });
});

router.post('/api/ai/topics/preload', auth, (req, res) => {
  const { avoid = [], triggerTopic = '' } = req.body || {};
  queueHomeTopicPoolRefresh(req.user.username, { avoid, triggerTopic, poolSize: 24 });
  res.json({ ok: true });
});

async function generateSuggestedPairForUser(username, { avoidTopics = [], triggerTopic = '' } = {}) {
  const games = await recentUserGames(username, 25);
  const recent = games.slice(-12);
  const sameField = [...new Set(recent.map(g => String(g.topic || '').trim()).filter(Boolean))].slice(-8);
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const fallbackPair = makeFallbackPair(avoidSet, triggerTopic || sameField[sameField.length - 1] || '');

  const stp = buildSuggestedTopicPrompt({ triggerTopic, recent, sameField, trendSeeds: GLOBAL_TREND_SEEDS, avoidSet });
  const ai = await generateStructured([
    { role: 'system', content: stp.system },
    { role: 'user', content: stp.user }
  ], { temperature: 0.78, maxTokens: 2600 });

  const raw = Array.isArray(ai.suggestions) ? ai.suggestions : [];
  const normalized = [0, 1].map(i => normalizeSuggestion(raw[i] || {}, fallbackPair[i], avoidSet));
  const unique = normalized.filter((v, i, arr) => arr.findIndex(x => x.topic.toLowerCase() === v.topic.toLowerCase()) === i);
  if (unique.length < 2) {
    for (const fb of fallbackPair) {
      if (unique.length >= 2) break;
      if (!unique.some(v => v.topic.toLowerCase() === fb.topic.toLowerCase())) unique.push(fb);
    }
  }
  return unique.slice(0, 2);
}

async function refreshSuggestedPairForUser(username, options = {}, store = null) {
  const activeStore = store || await readSuggestedStore();
  const pair = await generateSuggestedPairForUser(username, options);
  const previous = activeStore.users[username] || {};
  activeStore.users[username] = {
    pair,
    cursor: Number.isInteger(previous.cursor) ? previous.cursor : 0,
    lastShownTopic: String(previous.lastShownTopic || '').trim() || null,
    updatedAt: new Date().toISOString(),
    triggerTopic: String(options.triggerTopic || '').trim() || null
  };
  await writeSuggestedStore(activeStore);
  saveGeneration('suggestions', crypto.randomUUID(), {
    username,
    options,
    pair,
    createdAt: new Date().toISOString()
  });
  return pair;
}

function queueSuggestedPairRefresh(username, options = {}) {
  setTimeout(() => {
    refreshSuggestedPairForUser(username, options).catch(e => {
      console.error('Background suggested-topic refresh failed:', e.message);
    });
  }, 0);
}

// ---------- AI: fast suggested topic from JSON preload pair ----------
router.post('/api/ai/suggested-topic', auth, async (req, res) => {
  const { avoidTopics = [], refresh = false, triggerTopic = '' } = req.body || {};
  const avoidSet = new Set((Array.isArray(avoidTopics) ? avoidTopics : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const store = await readSuggestedStore();

  if (refresh) {
    try {
      const pair = await refreshSuggestedPairForUser(req.user.username, { avoidTopics, triggerTopic }, store);
      const entry = store.users[req.user.username] || { pair, lastShownTopic: null };
      const picked = randomPickSuggestionNoRepeat(entry.pair || pair, avoidSet, entry.lastShownTopic) || pair[0] || DEFAULT_SUGGESTION_PAIR[0];
      entry.lastShownTopic = picked.topic;
      store.users[req.user.username] = entry;
      await writeSuggestedStore(store);
      return res.json({ ...picked, cached: false, pairUpdated: true });
    } catch {
      const fallback = makeFallbackPair(avoidSet, triggerTopic)[0];
      return res.json({ ...fallback, cached: true, pairUpdated: false });
    }
  }

  const userPair = Array.isArray(store.users?.[req.user.username]?.pair)
    ? store.users[req.user.username].pair.filter(isValidSuggestion)
    : [];
  const defaults = (Array.isArray(store.defaults) && store.defaults.length)
    ? store.defaults.filter(isValidSuggestion)
    : DEFAULT_SUGGESTION_PAIR;

  const activePair = userPair.length ? userPair : defaults;
  if (!userPair.length) {
    store.users[req.user.username] = {
      pair: activePair.slice(0, 2),
      cursor: 0,
      lastShownTopic: null,
      updatedAt: new Date().toISOString(),
      triggerTopic: null
    };
    await writeSuggestedStore(store);
    queueSuggestedPairRefresh(req.user.username, { avoidTopics, triggerTopic });
  }

  const entry = store.users[req.user.username] || { pair: activePair, lastShownTopic: null };
  const picked = randomPickSuggestionNoRepeat(entry.pair || activePair, avoidSet, entry.lastShownTopic) || activePair[0] || DEFAULT_SUGGESTION_PAIR[0];
  entry.lastShownTopic = picked.topic;
  store.users[req.user.username] = entry;
  await writeSuggestedStore(store);
  res.json({ ...picked, cached: true, pairUpdated: false });
});

// ---------- AI: background preload refresh after home-page interactions ----------
router.post('/api/ai/suggested-topic/preload', auth, (req, res) => {
  const { avoidTopics = [], triggerTopic = '' } = req.body || {};
  queueSuggestedPairRefresh(req.user.username, { avoidTopics, triggerTopic });
  res.json({ ok: true });
});

// ---------- AI: random headline for time-travel news generator ----------
router.post('/api/ai/time-travel-headline', auth, async (req, res) => {
  const { period = 'future', avoidHeadlines = [] } = req.body || {};
  const normalizedPeriod = ['past', 'present', 'future'].includes(String(period).toLowerCase())
    ? String(period).toLowerCase()
    : 'future';
  const avoidSet = new Set((Array.isArray(avoidHeadlines) ? avoidHeadlines : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));

  const fallbackPool = {
    past: [
      'Printing Press Sparks Knowledge Boom Across Europe',
      'Ancient Engineers Race to Rebuild Earthquake-Struck Harbor',
      'Young Astronomers Redraw the Night Sky with New Instruments',
      'City-State Debates First Public Health Rules After Outbreak'
    ],
    present: [
      'Local Grid Uses AI Forecasts to Prevent Blackouts During Heat Wave',
      'Students Track Urban Flood Risks with Open Satellite Data',
      'Community Lab Designs Low-Cost Air Quality Alerts',
      'Hospitals Test New Data Dashboards to Speed Emergency Care'
    ],
    future: [
      'Mars Transit Council Approves First Interplanetary Water Treaty',
      'Floating Cities Deploy Storm-Deflection Fields Ahead of Mega Cyclone',
      'Lunar Farms Rewrite Food Supply Chains for Deep-Space Colonies',
      'Quantum Weather Net Warns Coastal Regions 30 Days Earlier'
    ]
  };

  try {
    const games = await recentUserGames(req.user.username, 20);
    const interests = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-10);
    const status = summarizeLearnerStatus(games);
    const tth = buildTimeTravelHeadlinePrompt({ normalizedPeriod, interests, status, trendSeeds: GLOBAL_TREND_SEEDS, avoidSet });
    const result = await generateStructured([
      { role: 'system', content: tth.system },
      { role: 'user', content: tth.user }
    ], { temperature: 0.85, maxTokens: 240 });

    const raw = String(result.headline || '').trim();
    if (raw && !avoidSet.has(raw.toLowerCase())) return res.json({ headline: raw });
    throw new Error('Invalid headline');
  } catch {
    const pool = fallbackPool[normalizedPeriod] || fallbackPool.future;
    const candidate = pool.find(h => !avoidSet.has(h.toLowerCase())) || pool[0];
    res.json({ headline: candidate });
  }
});

// ---------- AI: suggested topic + settings for structured explanations ----------
router.post('/api/ai/structured-explanation-suggest', auth, async (req, res) => {
  const { avoidPrompts = [] } = req.body || {};
  const avoidSet = new Set((Array.isArray(avoidPrompts) ? avoidPrompts : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));

  let games = [];
  try { games = await recentUserGames(req.user.username, 20); } catch { games = []; }
  // Varied, history-grounded default used both to fill any gaps in the AI reply and
  // when no AI provider is reachable (so repeated clicks never return one fixed topic).
  const fallback = buildStructuredSuggestFallback(games, avoidSet);

  try {
    const interests = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-12);
    const status = summarizeLearnerStatus(games);
    const ssp = buildStructuredSuggestPrompt({ interests, status, avoidSet });
    const result = await generateStructured([
      { role: 'system', content: ssp.system },
      { role: 'user', content: ssp.user }
    ], { temperature: 0.8, maxTokens: 700 });

    const prompt = String(result.prompt || '').trim();
    const out = {
      prompt: (prompt && !avoidSet.has(prompt.toLowerCase())) ? prompt : fallback.prompt,
      exampleType: ['proof', 'worked-example', 'graph-table', 'tree-diagram', 'outline'].includes(result.exampleType) ? result.exampleType : fallback.exampleType,
      level: ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'].includes(result.level) ? result.level : fallback.level,
      tone: String(result.tone || '').trim() || fallback.tone,
      complexity: ['simple', 'standard', 'scholarly'].includes(result.complexity) ? result.complexity : fallback.complexity,
      paragraphLength: ['brief', 'medium', 'detailed'].includes(result.paragraphLength) ? result.paragraphLength : fallback.paragraphLength,
      imageDensity: ['text-only', 'mostly-text', 'balanced', 'mostly-visual'].includes(result.imageDensity) ? result.imageDensity : fallback.imageDensity,
      totalSlides: Math.min(20, Math.max(2, parseInt(result.totalSlides, 10) || fallback.totalSlides)),
      continuation: ['more-examples', 'different-examples', 'related-topics'].includes(result.continuation) ? result.continuation : fallback.continuation,
      alternateVisualMath: result.alternateVisualMath !== false
    };

    res.json(out);
  } catch {
    // Fresh varied pick each call so the button rotates instead of repeating one topic.
    res.json(buildStructuredSuggestFallback(games, avoidSet));
  }
});

// ---------- AI: refresh concepts for one level only ----------
router.post('/api/ai/path/level-refresh', auth, async (req, res) => {
  const { topic, level, count = 5, avoidConcepts = [], guidance } = req.body || {};
  if (!topic || !level) return res.status(400).json({ error: 'Topic and level are required' });
  const wanted = Math.min(8, Math.max(3, parseInt(count, 10) || 5));
  const games = await recentUserGames(req.user.username, 20);
  const recent = games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): ${g.correct}/${g.total}`).join('\n');
  const avoid = (Array.isArray(avoidConcepts) ? avoidConcepts : []).map(String).filter(Boolean).slice(0, 40);

  if (!geminiEnabled && !deepseekEnabled) {
    return res.json(makeFallbackLevelConcepts(topic, level, wanted, avoid));
  }

  try {
    const lr = buildLevelRefreshPrompt({ level, wanted, topic, guidance, avoid, recent });
    const result = await generateStructured([
      { role: 'system', content: lr.system },
      { role: 'user', content: lr.user }
    ], { temperature: 0.8, maxTokens: 2200 });

    const out = {
      level,
      description: String(result.description || '').trim(),
      concepts: (result.concepts || [])
        .map(c => ({ name: String(c.name || '').trim(), blurb: String(c.blurb || '').trim() }))
        .filter(c => c.name)
        .filter((c, i, arr) => arr.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase()) === i)
        .slice(0, wanted)
    };
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: one slide (also used to prefetch each answer branch) ----------
router.post('/api/ai/slide', auth, async (req, res) => {
  const { gameId, topic, concept, level, settings = {}, slideNumber, totalSlides, history = [], branch } = req.body || {};
  if (!topic || !concept || !slideNumber || !totalSlides) return res.status(400).json({ error: 'Missing slide context' });
  const learnerGames = await recentUserGames(req.user.username, 20);
  const learnerProfile = summarizeLearnerVisualProfile(learnerGames);

  const paragraphWords = { brief: '40-60', medium: '70-100', detailed: '110-150' }[settings.paragraphLength] || '70-100';
  const paraCount = Math.min(7, Math.max(1, parseInt(settings.paragraphCount, 10) || 3));
  const densityRule = {
    'text-only': 'Use NO visual components (no svg/latex/code/image) — prose only.',
    'mostly-text': 'Mostly text: the paragraphs plus at most ONE visual component.',
    'balanced': 'Include the paragraphs plus ONE well-chosen visual that carries as much meaning as the words.',
    'mostly-visual': `Lead with 1-2 visual components that dominate the slide, but STILL include at least TWO connected paragraphs (each ${paragraphWords} words) explaining them.`
  }[settings.imageDensity] || 'Include one visual component alongside the paragraphs.';
  const allowModelSvg = !imageEnabled && !claudeSvgEnabled;
  const isTimeTravelActivity = settings.activityType === 'time-travel' || /time\s*travel|\bfuture\b|\bpast\b|\bpresent\b|headline|news/i.test(`${topic} ${concept} ${settings.customInstructions || ''}`);
  const proofMode = String(settings.exampleType || '').toLowerCase() === 'proof';
  const stemFocus = /math|physics|program|algorithm|computer|data|statistics|calculus|algebra|geometry|numerical|machine learning|ai|engineering|cryptography|proof|equation|formula|theorem|derivative|integral|linear algebra|probability/i
    .test(`${topic} ${concept}`);
  const subjectText = `${topic} ${concept}`.toLowerCase();
  const dataFocus = /statistic|data|economics|econ|demograph|market|survey|population|climate|trend|distribution|frequency|percentage|budget|finance|trade|gdp|growth rate|poll/.test(subjectText);
  const illustrativeFocus = /history|histor|war|revolution|empire|ancient|medieval|civiliz|politic|philosoph|literature|art|culture|religion|social|geograph|biograph|anecdote|language|law|ethics/.test(subjectText);
  // Whether LaTeX/formulas make sense at all: only for genuinely mathematical/symbolic
  // topics. A language, history or arts lesson must NEVER get LaTeX, even if the activity's
  // focus mode defaults to "proof". This is what keeps a French grammar slide from turning
  // into a formula or a bare logic list instead of real support material.
  const mathTopic = /math|physics|calculus|algebra|geometry|trigonometr|equation|formula|theorem|derivative|integral|matrix|vector|probabilit|statistic|arithmetic|number theory|\bproof\b|logic gate|boolean|quantum|mechanics|thermodynam|chemistr|algorithm|computer science|cryptograph|data structure|linear algebra|differential|calculation|electr(o|ical)|circuit/i.test(subjectText);
  const languageOrHumanities = /french|spanish|english|german|italian|portuguese|mandarin|chinese|japanese|korean|arabic|latin|\blanguage\b|grammar|vocabular|conjugat|\bverb\b|\bnoun\b|\btense\b|pronunciat|spelling|history|geograph|\bart\b|music|literature|poetry|philosoph|\blaw\b|politic|culture|religion|anatomy|cooking|writing|essay|social studies/i.test(subjectText);
  const allowLatex = (stemFocus || mathTopic) && !languageOrHumanities;
  // Proof/derivation behaviour only applies when the subject is actually mathematical.
  const effectiveProof = proofMode && allowLatex;
  // Subject-aware guidance so the AI picks components on purpose, not at random.
  const componentStrategy = allowLatex
    ? 'This is a technical/quantitative subject: reach first for LaTeX (formulas, derivations), then a chart (bar/line/scatter for relationships and trends) or a labelled svg diagram, and code when it is a computing topic. Use a sticky note only for a single crucial formula caveat or mnemonic.'
    : (illustrativeFocus || languageOrHumanities)
      ? 'This is a language/humanities/conceptual subject: do NOT use LaTeX or formulas at all. Reach for a generated IMAGE to illustrate, a TABLE (e.g. conjugation/comparison/before-after/timeline), an SVG diagram for structure or relationships, and sticky notes for a rule, example, mnemonic, or anecdote. Every slide must carry at least one such support component — never a bare list of generic steps with no visual.'
      : dataFocus
        ? 'This is a data-driven subject: reach first for a chart that fits the data\'s job — bar for comparing categories, line for change over time, pie for parts of a whole, scatter/bubble for relationships — with a sticky note or table calling out the single most important reading. Do NOT use LaTeX for non-mathematical points. Only invent numbers that are realistic and clearly illustrative.'
        : 'Pick the one or two components that most clarify THIS concept: an image or svg diagram to illustrate, a table for structured comparisons, a chart for quantities/relationships, a sticky note for a highlight. Use LaTeX ONLY if the concept is genuinely mathematical. Never leave a slide as a bare list of generic steps with no support component.';
  const visualPlan = decideAdaptiveVisualMode({
    topic,
    concept,
    settings,
    proofMode: effectiveProof,
    isTimeTravelActivity,
    stemFocus: allowLatex,
    learnerProfile
  });
  const canGenerateImage = visualPlan.allowImages;
  const equationDepth = {
    brief: 'Use 1 compact but meaningful derivation/proof block with 2-4 lines.',
    medium: 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.',
    detailed: 'Use a longer derivation/proof with 7-12 lines, explicitly showing key intermediate steps and assumptions.'
  }[settings.paragraphLength] || 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.';
  const codeDepth = {
    brief: 'Use a focused snippet around 8-15 lines.',
    medium: 'Use a practical snippet around 16-28 lines.',
    detailed: 'Use a richer snippet around 28-45 lines, still coherent and runnable.'
  }[settings.paragraphLength] || 'Use a practical snippet around 16-28 lines.';
  const stemAlternation = slideNumber % 2 === 1
    ? 'STEM alternation for this slide: emphasize theory + formulas/proof first, then support with a visual aid.'
    : 'STEM alternation for this slide: emphasize visual intuition first, then include code or formulas/proof with detailed explanation.';

  const system = buildSlideSystemPrompt({
    paraCount, paragraphWords, densityRule, componentStrategy, codeDepth,
    equationDepth, allowLatex, stemAlternation, effectiveProof,
    isTimeTravelActivity, allowModelSvg, settings, level,
    visualPromptRule: visualPlan.promptRule
  });

  const historyText = buildSlideHistoryText(history);
  const branchText = buildSlideBranchText(branch);

  if (!geminiEnabled && !deepseekEnabled) {
    const slide = makeFallbackSlide({ topic, concept, level, settings, slideNumber, totalSlides, branch });
    slide.components = sanitizeComponents(slide.components);
    enforceLatexNarrativeCadence(slide, { topic, concept, slideNumber, proofMode: effectiveProof, stemFocus: allowLatex, history, branch });
    if (isTimeTravelActivity && visualPlan.allowImages) {
      enforceTimeTravelImagePolicy(slide, { topic, concept, slideNumber, totalSlides, customInstructions: settings.customInstructions || '' });
    } else if (visualPlan.allowImages && !slide.components.some(c => c?.type === 'image')) {
      slide.components.push({
        type: 'image',
        prompt: buildGenericImagePrompt(slide, { topic, concept, slideNumber, totalSlides }),
        frame: slideNumber % 2 === 0 ? 'polaroid' : 'paper',
        caption: `Concept illustration: ${String(slide.title || concept).slice(0, 80)}`
      });
    }
    if (settings.imageDensity === 'text-only') {
      slide.components = (slide.components || []).filter(c => !['svg', 'image', 'latex', 'code', 'table', 'chart'].includes(c.type));
    }
    if (!visualPlan.allowImages) {
      slide.components = (slide.components || []).filter(c => c?.type !== 'image' && c?.type !== 'svg');
    }
    if (visualPlan.allowImages) {
      await fillImages(slide.components || []);
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    const genId = `${gameId || 'nogame'}-slide${slideNumber}-fallback`;
    saveGeneration('slides', genId, {
      username: req.user.username,
      topic,
      concept,
      level,
      settings,
      slideNumber,
      branch: branch || null,
      fallback: true,
      slide,
      createdAt: new Date().toISOString()
    });
    return res.json(slide);
  }

  const user = buildSlideUserPrompt({ topic, concept, level, slideNumber, totalSlides, historyText, branchText });

  try {
    const slide = await generateStructured([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 8192 });
    slide.components = sanitizeComponents(slide.components);
    enforceLatexNarrativeCadence(slide, { topic, concept, slideNumber, proofMode: effectiveProof, stemFocus: allowLatex, history, branch });
    if (!visualPlan.allowImages) {
      slide.components = (slide.components || []).filter(c => c?.type !== 'image' && c?.type !== 'svg');
    }
    if (isTimeTravelActivity && visualPlan.allowImages) {
      enforceTimeTravelImagePolicy(slide, { topic, concept, slideNumber, totalSlides, customInstructions: settings.customInstructions || '' });
    } else if (visualPlan.allowImages && !slide.components.some(c => c?.type === 'image')) {
      slide.components.push({
        type: 'image',
        prompt: buildGenericImagePrompt(slide, { topic, concept, slideNumber, totalSlides }),
        frame: slideNumber % 2 === 0 ? 'polaroid' : 'paper',
        caption: `Concept illustration: ${String(slide.title || concept).slice(0, 80)}`
      });
    }
    if (settings.imageDensity === 'text-only' && !effectiveProof) {
      slide.components = slide.components.filter(c => !['latex', 'code', 'table', 'chart'].includes(c.type));
    }
    // If the topic is not mathematical, strip any LaTeX the model added anyway.
    if (!allowLatex) {
      slide.components = (slide.components || []).filter(c => c?.type !== 'latex');
    }
    if (effectiveProof && slideNumber % 4 !== 0 && !slide.components.some(c => c?.type === 'latex')) {
      slide.components.unshift({
        type: 'latex',
        content: makeFallbackProofLatex({ topic, concept, slideNumber, branch }),
        caption: `Step ${slideNumber}`
      });
    }
    if (visualPlan.allowImages) {
      await fillImages(slide.components || []);
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    if (!slide.quiz || !Array.isArray(slide.quiz.options) || !slide.quiz.options.some(o => o.correct)) {
      throw new Error('Model returned a slide without a valid quiz, please retry');
    }
    const genId = `${gameId || 'nogame'}-slide${slideNumber}${branch ? '-' + (branch.correct ? 'deeper' : 'remedial') + '-' + crypto.randomBytes(3).toString('hex') : ''}`;
    saveGeneration('slides', genId, { username: req.user.username, topic, concept, level, settings, slideNumber, branch: branch || null, slide, createdAt: new Date().toISOString() });
    res.json(slide);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: end-of-game recommendations ----------
router.post('/api/ai/recommend', auth, async (req, res) => {
  const { topic, concept, level, correct, total, durationSec, slides = [] } = req.body || {};
  const history = await recentUserGames(req.user.username, 12);
  if (!geminiEnabled && !deepseekEnabled) {
    const fallback = makeFallbackRecommendation({ topic, concept, level, correct, total, slides });
    saveGeneration('recommendations', crypto.randomUUID(), { username: req.user.username, topic, concept, result: fallback, fallback: true, createdAt: new Date().toISOString() });
    return res.json(fallback);
  }
  try {
    const rec = buildRecommendPrompt({ topic, concept, level, correct, total, durationSec, history, slides });
    const result = await generateStructured([
      { role: 'system', content: rec.system },
      { role: 'user', content: rec.user }
    ], { temperature: 0.7, maxTokens: 4096 });
    const questionSummary = slides.map(s => String(s.question || '').trim()).filter(Boolean);
    const answerSummary = slides.map(s => String(s.chosen || '').trim()).filter(Boolean);
    const normalized = {
      summary: String(result.summary || '').trim(),
      questionSummary,
      answerSummary,
      aiNotes: Array.isArray(result.aiNotes) ? result.aiNotes.map(v => String(v).trim()).filter(Boolean) : [],
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.map(v => String(v).trim()).filter(Boolean) : [],
      nextConcepts: Array.isArray(result.nextConcepts) ? result.nextConcepts : []
    };
    saveGeneration('recommendations', crypto.randomUUID(), { username: req.user.username, topic, concept, result: normalized, createdAt: new Date().toISOString() });
    res.json(normalized);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: coach chat (sees the user's progress data) ----------
router.post('/api/ai/chat', auth, async (req, res) => {
  const { messages = [] } = req.body || {};
  const games = readJSON('games.json', []).filter(g => g.username === req.user.username);
  const progress = games.slice(-20).map(g => ({
    date: g.finishedAt, topic: g.topic, concept: g.concept, level: g.level,
    score: `${g.correct}/${g.total}`, durationSec: g.durationSec
  }));
  if (!geminiEnabled && !deepseekEnabled) {
    return res.json({ reply: makeFallbackCoachReply(progress) });
  }
  try {
    const reply = await generateText([
      { role: 'system', content: buildCoachChatSystem({ progress, username: req.user.username }) },
      ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
    ], { json: false, temperature: 0.8, maxTokens: 800 });
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Public runtime config so the client can show a "demo mode" banner when no AI is set.
router.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({
    aiEnabled: !!(geminiEnabled || deepseekEnabled),
    provider: geminiEnabled ? 'gemini' : (deepseekEnabled ? 'deepseek' : null),
    imagesEnabled: !!imageEnabled
  });
});

module.exports = router;
