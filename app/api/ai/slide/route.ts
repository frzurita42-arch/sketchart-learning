import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { geminiEnabled, deepseekEnabled, imageEnabled, claudeSvgEnabled } from '@/src/config';
import { saveGeneration } from '@/src/db/persistence';
import { recentUserGames } from '@/src/db/games';
import { generateStructured, fillImages } from '@/src/ai/providers';
import {
  buildSlideSystemPrompt, buildSlideHistoryText, buildSlideBranchText, buildSlideUserPrompt,
} from '@/src/ai/prompts/slide';
import { sanitizeComponents } from '@/src/slides/sanitize';
import { makeFallbackSlide, makeFallbackProofLatex } from '@/src/slides/fallback';
import {
  enforceSlideVisualPolicy, enforceLatexNarrativeCadence, decideAdaptiveVisualMode,
  summarizeLearnerVisualProfile, enforceTimeTravelImagePolicy, buildGenericImagePrompt,
} from '@/src/slides/visual-policy';
import { requireAuth } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await requireAuth(req);
  if (!a.ok) return a.response;
  const { gameId, topic, concept, level, settings = {}, slideNumber, totalSlides, history = [], branch } = (await req.json().catch(() => ({}))) || {};
  if (!topic || !concept || !slideNumber || !totalSlides) return NextResponse.json({ error: 'Missing slide context' }, { status: 400 });
  const learnerGames = await recentUserGames(a.user.username, 20);
  const learnerProfile = summarizeLearnerVisualProfile(learnerGames);

  const paragraphWords = ({ brief: '40-60', medium: '70-100', detailed: '110-150' } as any)[settings.paragraphLength] || '70-100';
  const paraCount = Math.min(7, Math.max(1, parseInt(settings.paragraphCount, 10) || 3));
  const densityRule = ({
    'text-only': 'Use NO visual components (no svg/latex/code/image) — prose only.',
    'mostly-text': 'Mostly text: the paragraphs plus at most ONE visual component.',
    'balanced': 'Include the paragraphs plus ONE well-chosen visual that carries as much meaning as the words.',
    'mostly-visual': `Lead with 1-2 visual components that dominate the slide, but STILL include at least TWO connected paragraphs (each ${paragraphWords} words) explaining them.`,
  } as any)[settings.imageDensity] || 'Include one visual component alongside the paragraphs.';
  const allowModelSvg = !imageEnabled && !claudeSvgEnabled;
  const isTimeTravelActivity = settings.activityType === 'time-travel' || /time\s*travel|\bfuture\b|\bpast\b|\bpresent\b|headline|news/i.test(`${topic} ${concept} ${settings.customInstructions || ''}`);
  const proofMode = String(settings.exampleType || '').toLowerCase() === 'proof';
  const stemFocus = /math|physics|program|algorithm|computer|data|statistics|calculus|algebra|geometry|numerical|machine learning|ai|engineering|cryptography|proof|equation|formula|theorem|derivative|integral|linear algebra|probability/i
    .test(`${topic} ${concept}`);
  const subjectText = `${topic} ${concept}`.toLowerCase();
  const dataFocus = /statistic|data|economics|econ|demograph|market|survey|population|climate|trend|distribution|frequency|percentage|budget|finance|trade|gdp|growth rate|poll/.test(subjectText);
  const illustrativeFocus = /history|histor|war|revolution|empire|ancient|medieval|civiliz|politic|philosoph|literature|art|culture|religion|social|geograph|biograph|anecdote|language|law|ethics/.test(subjectText);
  const mathTopic = /math|physics|calculus|algebra|geometry|trigonometr|equation|formula|theorem|derivative|integral|matrix|vector|probabilit|statistic|arithmetic|number theory|\bproof\b|logic gate|boolean|quantum|mechanics|thermodynam|chemistr|algorithm|computer science|cryptograph|data structure|linear algebra|differential|calculation|electr(o|ical)|circuit/i.test(subjectText);
  const languageOrHumanities = /french|spanish|english|german|italian|portuguese|mandarin|chinese|japanese|korean|arabic|latin|\blanguage\b|grammar|vocabular|conjugat|\bverb\b|\bnoun\b|\btense\b|pronunciat|spelling|history|geograph|\bart\b|music|literature|poetry|philosoph|\blaw\b|politic|culture|religion|anatomy|cooking|writing|essay|social studies/i.test(subjectText);
  const allowLatex = (stemFocus || mathTopic) && !languageOrHumanities;
  const effectiveProof = proofMode && allowLatex;
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
    learnerProfile,
  });
  const equationDepth = ({
    brief: 'Use 1 compact but meaningful derivation/proof block with 2-4 lines.',
    medium: 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.',
    detailed: 'Use a longer derivation/proof with 7-12 lines, explicitly showing key intermediate steps and assumptions.',
  } as any)[settings.paragraphLength] || 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.';
  const codeDepth = ({
    brief: 'Use a focused snippet around 8-15 lines.',
    medium: 'Use a practical snippet around 16-28 lines.',
    detailed: 'Use a richer snippet around 28-45 lines, still coherent and runnable.',
  } as any)[settings.paragraphLength] || 'Use a practical snippet around 16-28 lines.';
  const stemAlternation = slideNumber % 2 === 1
    ? 'STEM alternation for this slide: emphasize theory + formulas/proof first, then support with a visual aid.'
    : 'STEM alternation for this slide: emphasize visual intuition first, then include code or formulas/proof with detailed explanation.';

  const system = buildSlideSystemPrompt({
    paraCount, paragraphWords, densityRule, componentStrategy, codeDepth,
    equationDepth, allowLatex, stemAlternation, effectiveProof,
    isTimeTravelActivity, allowModelSvg, settings, level,
    visualPromptRule: visualPlan.promptRule,
  });

  const historyText = buildSlideHistoryText(history);
  const branchText = buildSlideBranchText(branch);

  if (!geminiEnabled && !deepseekEnabled) {
    const slide = makeFallbackSlide({ topic, concept, level, settings, slideNumber, totalSlides, branch });
    slide.components = sanitizeComponents(slide.components);
    enforceLatexNarrativeCadence(slide, { topic, concept, slideNumber, proofMode: effectiveProof, stemFocus: allowLatex, history, branch });
    if (isTimeTravelActivity && visualPlan.allowImages) {
      enforceTimeTravelImagePolicy(slide, { topic, concept, slideNumber, totalSlides, customInstructions: settings.customInstructions || '' });
    } else if (visualPlan.allowImages && !slide.components.some((c: any) => c?.type === 'image')) {
      slide.components.push({
        type: 'image',
        prompt: buildGenericImagePrompt(slide, { topic, concept, slideNumber, totalSlides }),
        frame: slideNumber % 2 === 0 ? 'polaroid' : 'paper',
        caption: `Concept illustration: ${String(slide.title || concept).slice(0, 80)}`,
      });
    }
    if (settings.imageDensity === 'text-only') {
      slide.components = (slide.components || []).filter((c: any) => !['svg', 'image', 'latex', 'code', 'table', 'chart'].includes(c.type));
    }
    if (!visualPlan.allowImages) {
      slide.components = (slide.components || []).filter((c: any) => c?.type !== 'image' && c?.type !== 'svg');
    }
    if (visualPlan.allowImages) {
      await fillImages(slide.components || []);
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    const genId = `${gameId || 'nogame'}-slide${slideNumber}-fallback`;
    saveGeneration('slides', genId, {
      username: a.user.username,
      topic, concept, level, settings, slideNumber,
      branch: branch || null,
      fallback: true,
      slide,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json(slide);
  }

  const user = buildSlideUserPrompt({ topic, concept, level, slideNumber, totalSlides, historyText, branchText });

  try {
    const slide = await generateStructured([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 8192 });
    slide.components = sanitizeComponents(slide.components);
    enforceLatexNarrativeCadence(slide, { topic, concept, slideNumber, proofMode: effectiveProof, stemFocus: allowLatex, history, branch });
    if (!visualPlan.allowImages) {
      slide.components = (slide.components || []).filter((c: any) => c?.type !== 'image' && c?.type !== 'svg');
    }
    if (isTimeTravelActivity && visualPlan.allowImages) {
      enforceTimeTravelImagePolicy(slide, { topic, concept, slideNumber, totalSlides, customInstructions: settings.customInstructions || '' });
    } else if (visualPlan.allowImages && !slide.components.some((c: any) => c?.type === 'image')) {
      slide.components.push({
        type: 'image',
        prompt: buildGenericImagePrompt(slide, { topic, concept, slideNumber, totalSlides }),
        frame: slideNumber % 2 === 0 ? 'polaroid' : 'paper',
        caption: `Concept illustration: ${String(slide.title || concept).slice(0, 80)}`,
      });
    }
    if (settings.imageDensity === 'text-only' && !effectiveProof) {
      slide.components = slide.components.filter((c: any) => !['latex', 'code', 'table', 'chart'].includes(c.type));
    }
    // If the topic is not mathematical, strip any LaTeX the model added anyway.
    if (!allowLatex) {
      slide.components = (slide.components || []).filter((c: any) => c?.type !== 'latex');
    }
    if (effectiveProof && slideNumber % 4 !== 0 && !slide.components.some((c: any) => c?.type === 'latex')) {
      slide.components.unshift({
        type: 'latex',
        content: makeFallbackProofLatex({ topic, concept, slideNumber, branch }),
        caption: `Step ${slideNumber}`,
      });
    }
    if (visualPlan.allowImages) {
      await fillImages(slide.components || []);
    }
    enforceSlideVisualPolicy(slide, history, slideNumber);
    if (!slide.quiz || !Array.isArray(slide.quiz.options) || !slide.quiz.options.some((o: any) => o.correct)) {
      throw new Error('Model returned a slide without a valid quiz, please retry');
    }
    const genId = `${gameId || 'nogame'}-slide${slideNumber}${branch ? '-' + (branch.correct ? 'deeper' : 'remedial') + '-' + crypto.randomBytes(3).toString('hex') : ''}`;
    saveGeneration('slides', genId, { username: a.user.username, topic, concept, level, settings, slideNumber, branch: branch || null, slide, createdAt: new Date().toISOString() });
    return NextResponse.json(slide);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
