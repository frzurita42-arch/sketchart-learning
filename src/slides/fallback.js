/* Offline fallback slide/lesson generators — used when no AI provider is reachable.
 * All pure: no DB, no provider flags, no network. */

function makeFallbackLearningPath(topic, wantedLevels) {
  const normalizedTopic = String(topic || 'General studies').trim() || 'General studies';
  const templates = {
    Beginner: ['Core vocabulary', 'Big-picture overview', 'Everyday examples', 'Common misconceptions'],
    'Lower Intermediate': ['Cause and effect', 'Key frameworks', 'Simple data interpretation', 'Practical decisions'],
    'Upper Intermediate': ['Trade-offs and constraints', 'Comparative analysis', 'Scenario planning', 'Structured critique'],
    Advanced: ['Systems interactions', 'Edge cases', 'Method evaluation', 'Implementation strategy'],
    PhD: ['Research gaps', 'Competing theories', 'Experimental design', 'Future directions']
  };

  return {
    topic: normalizedTopic,
    overview: `This fallback path introduces ${normalizedTopic} step by step and focuses on practical understanding. It can be used while AI providers are temporarily unavailable.`,
    levels: wantedLevels.map((level) => ({
      level,
      description: `Focused progression for ${normalizedTopic} at ${level} level.`,
      concepts: (templates[level] || templates.Beginner).map((name, idx) => ({
        name: `${normalizedTopic}: ${name}`,
        blurb: `Concept ${idx + 1} for ${level} mastery`
      }))
    }))
  };
}

function makeFallbackLevelConcepts(topic, level, wanted, avoidConcepts = []) {
  const normalizedTopic = String(topic || 'General studies').trim() || 'General studies';
  const avoidSet = new Set((Array.isArray(avoidConcepts) ? avoidConcepts : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const seeds = [
    'Foundations and key terms',
    'Trade-offs and constraints',
    'Practical workflow',
    'Common mistakes and fixes',
    'Evidence and measurement',
    'Case study and reflection',
    'Comparison with alternatives',
    'Implementation checklist'
  ];
  const concepts = [];
  for (const seed of seeds) {
    const name = `${normalizedTopic}: ${seed}`;
    if (avoidSet.has(name.toLowerCase())) continue;
    concepts.push({
      name,
      blurb: `Fallback concept for ${level} practice`
    });
    if (concepts.length >= wanted) break;
  }
  return {
    level,
    description: `Fallback concept refresh for ${normalizedTopic} at ${level} level.`,
    concepts
  };
}

function makeFallbackSlide({ topic, concept, level, settings = {}, slideNumber, totalSlides, branch }) {
  const paragraphWords = { brief: '40-60', medium: '70-100', detailed: '110-150' }[settings.paragraphLength] || '70-100';
  const titleBase = String(concept || topic || 'Learning concept').trim();
  const title = titleBase.split(/\s+/).slice(0, 8).join(' ');
  const exampleType = String(settings.exampleType || '').toLowerCase();
  // LaTeX/proof behaviour only for genuinely mathematical topics — a language or
  // humanities lesson must never get formulas even if the focus mode defaults to "proof".
  const fbSubject = `${topic} ${concept}`.toLowerCase();
  const fbMath = /math|physics|calculus|algebra|geometry|trigonometr|equation|formula|theorem|derivative|integral|matrix|vector|probabilit|statistic|arithmetic|number theory|\bproof\b|boolean|quantum|mechanics|thermodynam|chemistr|algorithm|computer science|cryptograph|data structure|linear algebra|differential|circuit/.test(fbSubject);
  const fbLangHum = /french|spanish|english|german|italian|portuguese|mandarin|chinese|japanese|korean|arabic|latin|\blanguage\b|grammar|vocabular|conjugat|\bverb\b|\bnoun\b|\btense\b|pronunciat|spelling|history|geograph|\bart\b|music|literature|poetry|philosoph|\blaw\b|politic|culture|religion|anatomy|cooking|writing|essay/.test(fbSubject);
  const fbAllowLatex = fbMath && !fbLangHum;
  const proofMode = exampleType === 'proof' && fbAllowLatex;
  const adaptationLine = branch
    ? (branch.correct
      ? 'You answered correctly on the previous step, so this slide goes a level deeper.'
      : `This slide targets a common misconception: ${String(branch.misconception || 'mixing up the core idea with a related one')}.`)
    : 'This slide builds a strong baseline before moving to harder cases.';

  const isTimeTravel = /time\s*travel|\bfuture\b|\bpast\b|\bpresent\b|headline|news/i.test(`${topic} ${concept} ${settings.customInstructions || ''}`);

  // Honor the learner's "paragraphs per slide" setting even in the offline fallback:
  // build exactly paraCount distinct paragraphs from a varied, coherent pool.
  const paraCount = Math.min(7, Math.max(1, parseInt(settings.paragraphCount, 10) || 3));
  const paraPool = proofMode
    ? [
        `At ${level} level, this proof page builds the derivation for ${concept}. Read the comments on the right of each line; they explain why the step is valid and how the proof continues. (${paragraphWords} style)`,
        `${adaptationLine} Keep the proof in one continuous block, and use the learner's previous answer to either repair a missing step or deepen the derivation.`,
        `State the assumptions first: what is given, what must be shown, and which prior result you are allowed to invoke for ${concept}. Naming these up front keeps the derivation honest.`,
        `Advance exactly one step, then justify it in words before writing the next line. A proof is only as strong as the weakest link, so each transition must follow necessarily from the last.`,
        `Watch the boundary and edge cases for ${concept}: where does the argument nearly break, and what condition rescues it? Handling these is what separates a sketch from a real proof.`,
        `Now consolidate: restate what the last few lines established and how they move you toward the goal, so the thread of the argument stays visible.`,
        `Before the next slide, try to reproduce this step from memory. If you can rebuild the logic unaided, you understand it; if not, revisit the assumption that made the step valid.`
      ]
    : [
        `At ${level} level, this step focuses on ${concept}. The goal is to connect the idea to real choices, constraints, and outcomes, not just memorize definitions. Read each paragraph and look for cause-effect logic you can reuse in new situations. (${paragraphWords} style)`,
        `${adaptationLine} Use the topic context (${topic}) to ask: what changes, what stays stable, and what evidence would confirm your interpretation? This comparison mindset prevents shallow pattern matching and improves transfer to unfamiliar examples.`,
        `Ground it in a concrete example drawn from ${topic}. Walk through one specific case slowly, naming the moving parts, so the abstract idea has something tangible to hang on.`,
        `Now contrast that case with a near-miss — a situation that looks similar but behaves differently. The boundary between them is usually where the real understanding of ${concept} lives.`,
        `Trace the consequences one more layer out: if this idea holds, what follows next, and what would you expect to observe? Predictions you can check are the fastest way to test comprehension.`,
        `Tie it back to what the previous slide established so the lesson reads as one continuous argument rather than isolated facts, and set up the question that comes next.`,
        `Before the next slide, summarize the concept in one sentence, then test it on a small scenario. If your explanation predicts outcomes and trade-offs, your understanding is likely solid; if not, revisit the key mechanism and assumptions.`
      ];
  const components = [];
  for (let i = 0; i < paraCount; i++) {
    components.push({ type: 'text', content: paraPool[i % paraPool.length] });
  }

  // Rotate through the WHOLE toolbox across slides so a presentation shows latex,
  // charts, tables, SVG diagrams and sticky notes — not one type repeated. Choice is
  // keyed to the subject and honors the support-material ratio (imageDensity).
  const density = settings.imageDensity || 'balanced';
  const shortConcept = String(concept || topic || 'the idea').trim().slice(0, 22);
  const escSvg = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  const buildSupport = (kind) => {
    if (kind === 'latex') {
      return { type: 'latex', content: makeFallbackProofLatex({ topic, concept, slideNumber, branch }), caption: `Key relation for ${title}` };
    }
    if (kind === 'chart') {
      const t = slideNumber % 3;
      if (t === 1) return { type: 'chart', chartType: 'line', title: `${shortConcept}: trend`, xLabel: 'Step', yLabel: 'Effect', points: [{ x: 1, y: 18 }, { x: 2, y: 33 }, { x: 3, y: 52 }, { x: 4, y: 69 }, { x: 5, y: 84 }], caption: 'Illustrative trend (offline demo values).' };
      if (t === 2) return { type: 'chart', chartType: 'pie', title: `${shortConcept}: breakdown`, series: [{ label: 'Part A', value: 45 }, { label: 'Part B', value: 30 }, { label: 'Part C', value: 25 }], caption: 'Illustrative split (offline demo values).' };
      return { type: 'chart', chartType: 'bar', title: `${shortConcept}: comparison`, series: [{ label: 'Case A', value: 40 + (slideNumber * 7) % 45 }, { label: 'Case B', value: 30 + (slideNumber * 13) % 50 }, { label: 'Case C', value: 25 + (slideNumber * 5) % 55 }], caption: 'Illustrative values (offline demo).' };
    }
    if (kind === 'table') {
      return { type: 'table', headers: ['Main idea', 'Different perspective'], rows: [[`Core claim about ${shortConcept}`, 'A useful alternate angle or correction'], ['What it predicts', 'What would count as evidence against it'], ['Where it applies', 'Where it tends to break down']], caption: `Compare-and-contrast for ${shortConcept}` };
    }
    if (kind === 'svg') {
      return { type: 'svg', caption: `How ${shortConcept} links cause to effect (slide ${slideNumber})`, svg: `<svg viewBox="0 0 440 170" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="60" width="120" height="54" rx="10" fill="#f7f3e9" stroke="#2d2a26" stroke-width="2.5"/><text x="24" y="92" font-size="14" fill="#2d2a26">Cause</text><rect x="160" y="60" width="120" height="54" rx="10" fill="#eaf1fb" stroke="#2d2a26" stroke-width="2.5"/><text x="172" y="92" font-size="13" fill="#2d2a26">${escSvg(shortConcept.slice(0, 14))}</text><rect x="308" y="60" width="120" height="54" rx="10" fill="#eef7ee" stroke="#2d2a26" stroke-width="2.5"/><text x="320" y="92" font-size="14" fill="#2d2a26">Effect</text><line x1="132" y1="87" x2="152" y2="87" stroke="#2d2a26" stroke-width="2.5"/><polygon points="152,82 162,87 152,92" fill="#2d2a26"/><line x1="280" y1="87" x2="300" y2="87" stroke="#2d2a26" stroke-width="2.5"/><polygon points="300,82 310,87 300,92" fill="#2d2a26"/></svg>` };
    }
    // sticky
    return {
      type: 'stickynote',
      color: fbLangHum ? 'green' : (slideNumber % 2 ? 'blue' : 'orange'),
      title: fbLangHum ? 'Remember' : 'Key idea',
      note: fbLangHum
        ? `A vivid detail helps ${shortConcept} stick — tie a date, name, or place to a story you can retell.`
        : `Restate ${shortConcept} in one sentence before moving on; if you can predict an outcome with it, it has sunk in.`
    };
  };

  if (density !== 'text-only') {
    // Non-mathematical topics never get a LaTeX slide; they lean on images, tables,
    // svg diagrams and sticky notes instead.
    const cycle = proofMode
      ? ['latex', 'chart', 'latex', 'table', 'latex', 'sticky']
      : fbLangHum
        ? ['sticky', 'table', 'svg', 'sticky', 'table', 'svg']
        : fbAllowLatex
          ? ['chart', 'latex', 'table', 'svg', 'sticky', 'chart']
          : ['chart', 'table', 'sticky', 'svg', 'chart', 'table'];
    const idx = (Math.max(1, slideNumber) - 1) % cycle.length;
    const want = density === 'mostly-visual' ? 2 : (density === 'balanced' && slideNumber % 2 === 0 ? 2 : 1);
    const seen = new Set();
    for (let k = 0; k < want; k++) {
      const kind = cycle[(idx + k) % cycle.length];
      if (seen.has(kind)) continue;
      seen.add(kind);
      components.push(buildSupport(kind));
    }
  }

  // Rotate through nuanced question forms whose options are parallel in length and
  // tone, so the answer isn't telegraphed (as close to "challenging" as an offline
  // template can get; real AI produces concept-specific questions).
  const quizVariants = [
    {
      question: `Applying ${shortConcept}: which conclusion follows ONLY when its key assumption actually holds?`,
      options: [
        { text: 'The result holds within its stated conditions and fails once they are violated', correct: true, explanation: 'Right — the conclusion is conditional on the assumption, so it breaks when the assumption does.', misconception: '' },
        { text: 'The result always holds, because the assumption is just a technicality', correct: false, explanation: 'Over-generalization: the assumption is what makes the result valid, not a formality.', misconception: 'Treats a load-bearing assumption as optional' },
        { text: 'The result never applies in practice, so the assumption is irrelevant', correct: false, explanation: 'Too dismissive: it applies precisely where the assumption is approximately true.', misconception: 'Discards a tool instead of scoping it' },
        { text: 'The assumption and the result are independent of each other', correct: false, explanation: 'They are linked: the result is derived from the assumption.', misconception: 'Misses the dependency between premise and conclusion' }
      ]
    },
    {
      question: `Which statement about ${shortConcept} gets the direction of cause and effect right?`,
      options: [
        { text: 'A change in the driver shifts the outcome, not the other way around', correct: true, explanation: 'Correct — the causal arrow runs from driver to outcome here.', misconception: '' },
        { text: 'The outcome determines the driver', correct: false, explanation: 'That reverses the causal direction.', misconception: 'Flips cause and effect' },
        { text: 'They rise and fall together, so either one causes the other', correct: false, explanation: 'Correlation alone does not fix a direction.', misconception: 'Confuses correlation with causation' },
        { text: 'Neither affects the other; both are fixed independently', correct: false, explanation: 'They are related, not independent.', misconception: 'Denies a real relationship' }
      ]
    },
    {
      question: `Where is ${shortConcept} MOST likely to break down?`,
      options: [
        { text: 'At the edges, where its assumptions stop being approximately true', correct: true, explanation: 'Right — models fail where their premises no longer hold.', misconception: '' },
        { text: 'In the simplest textbook case it was designed for', correct: false, explanation: 'That is exactly where it works best.', misconception: 'Inverts where a model is reliable' },
        { text: 'Only when the numbers involved are large', correct: false, explanation: 'Scale alone is not the failure point.', misconception: 'Picks an arbitrary trigger' },
        { text: 'Never — a correctly stated idea cannot break down', correct: false, explanation: 'Every model has a domain of validity.', misconception: 'Overconfidence in universal validity' }
      ]
    }
  ];
  const quiz = quizVariants[(Math.max(1, slideNumber) - 1) % quizVariants.length];

  return {
    title,
    summary: `Fallback slide ${slideNumber}/${totalSlides} reinforcing ${concept} at ${level} level while AI providers are unavailable.`,
    components,
    quiz
  };
}

function makeFallbackRecommendation({ topic, concept, level, correct, total, slides = [] }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCorrect = Math.max(0, Number(correct) || 0);
  const ratio = safeCorrect / safeTotal;
  const questionSummary = slides.map(s => String(s.question || '').trim()).filter(Boolean).slice(0, 3);
  const answerSummary = slides.map(s => String(s.chosen || '').trim()).filter(Boolean).slice(0, 3);
  const nextLevelMap = {
    Beginner: 'Lower Intermediate',
    'Lower Intermediate': 'Upper Intermediate',
    'Upper Intermediate': 'Advanced',
    Advanced: 'PhD',
    PhD: 'PhD'
  };
  const nextLevel = nextLevelMap[level] || level || 'Upper Intermediate';
  const summary = ratio >= 0.75
    ? `Strong work on ${concept}. Your score suggests you are ready to deepen accuracy and speed on more complex variants.`
    : `You are building momentum on ${concept}. A short targeted review should make your next attempt much more stable.`;

  return {
    summary,
    questionSummary,
    answerSummary,
    aiNotes: [
      `Current focus: ${topic} / ${concept} at ${level}.`,
      'Fallback coaching is active because AI providers are temporarily unavailable.',
      'Use one quick recap and one new example before replaying the activity.'
    ],
    recommendations: [
      'Rewrite the core idea in one sentence and list two assumptions.',
      'Practice one new scenario and explain trade-offs out loud.',
      'Replay with medium paragraph length and balanced visuals for retention.'
    ],
    nextConcepts: [
      { name: `${concept}: applied scenario analysis`, level: nextLevel },
      { name: `${concept}: edge cases and failure modes`, level: nextLevel }
    ]
  };
}

function makeFallbackCoachReply(progress = []) {
  const recent = Array.isArray(progress) ? progress.slice(-3) : [];
  if (!recent.length) {
    return 'I can still coach you while AI providers are offline. Start with a Beginner or Lower Intermediate concept, keep slides to 6-8, and use balanced visuals. After your first run, I can help you tune difficulty and pacing.';
  }
  const latest = recent[recent.length - 1];
  return `I can still coach you while AI providers are offline. Your latest activity was ${latest.topic} / ${latest.concept} at ${latest.level} with score ${latest.score}. Next, keep the same topic, lower complexity one step if accuracy was low, and run 6-8 slides with balanced visuals. Then retry at your original level.`;
}

function makeFallbackTable(slide, context = {}) {
  const title = String(slide?.title || context.concept || 'Concept').trim();
  const quiz = String(slide?.quiz?.question || 'How do we evaluate this concept?').trim();
  const perspective = String(slide?.summary || context.topic || 'Different perspective').trim();
  return {
    type: 'table',
    headers: ['Main idea', 'Different perspective'],
    rows: [
      [title.slice(0, 34), perspective.slice(0, 34)],
      ['Key question', quiz.slice(0, 34)],
      [String(context.topic || 'Topic').slice(0, 34), `Slide ${context.slideNumber || 1} correction`]
    ],
    caption: `Slide ${context.slideNumber || 1} main idea vs perspective table`
  };
}

function makeFallbackProofLatex({ topic = '', concept = '', slideNumber = 1, branch = null } = {}) {
  const text = `${topic} ${concept}`.toLowerCase();
  const phase = ((Math.max(1, Number(slideNumber) || 1) - 1) % 3) + 1;
  const correction = branch?.correct
    ? '\\text{cont.}'
    : '\\text{fix gap}';
  const tailComment = branch?.correct
    ? '\\text{extend}'
    : '\\text{resume}';

  if (/taylor/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
f(x) &= P_n(x) + R_n(x) && \text{split into approximation + remainder} \\
P_n(x) &= \sum_{k=0}^{n}\frac{f^{(k)}(a)}{k!}(x-a)^k && \text{Taylor polynomial around } a \\
R_n(x) &= f(x) - P_n(x) && ${correction} \\
&= \frac{f^{(n+1)}(\xi)}{(n+1)!}(x-a)^{n+1} && ${tailComment}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
R_n(x) &= f(x) - P_n(x) && \text{isolate the remainder} \\
&= f(x) - \sum_{k=0}^{n}\frac{f^{(k)}(a)}{k!}(x-a)^k && \text{substitute the polynomial} \\
&= \frac{f^{(n+1)}(\xi)}{(n+1)!}(x-a)^{n+1}, \quad \xi \in (a,x) && ${correction} \\
&\text{This remainder controls the error size.} && ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
\left|R_n(x)\right| &\le \frac{M}{(n+1)!}\left|x-a\right|^{n+1} && \text{bound with } M=\max|f^{(n+1)}| \\
	ext{choose } n &\text{ so the bound } < \varepsilon && \text{target accuracy} \\
&&& ${tailComment}
\end{aligned}`;
  }

  if (/bayes|diagnostic|test/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
P(H\mid E) &= \frac{P(E\mid H)P(H)}{P(E)} && \text{Bayes update} \\
P(E) &= P(E\mid H)P(H)+P(E\mid \neg H)P(\neg H) && \text{total evidence} \\
&&& ${correction}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
P(H\mid E) &= \frac{P(E\mid H)P(H)}{P(E\mid H)P(H)+P(E\mid\neg H)P(\neg H)} && \text{substitute } P(E) \\
&= \frac{\text{sensitivity}\cdot\text{prior}}{\text{sensitivity}\cdot\text{prior} + (1-\text{specificity})(1-\text{prior})} && \text{diagnostic form} \\
&&& ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
  	ext{Odds}(H\mid E) &= \text{Odds}(H)\cdot\frac{P(E\mid H)}{P(E\mid\neg H)} && \text{odds form} \\
\log\text{Odds}(H\mid E) &= \log\text{Odds}(H)+\log\text{LR}(E) && \text{additive evidence} \\
&&& ${tailComment}
\end{aligned}`;
  }

  if (/derivative|integral|calculus|series|limit|function|approximation/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
f'(x) &= \lim_{h\to 0}\frac{f(x+h)-f(x)}{h} && \text{definition} \\
&= \lim_{h\to 0}\left(\frac{f(x+h)-f(x)}{h}\right) && \text{set up simplification} \\
&&& ${correction}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
f(x+h) &= f(x) + hf'(x) + O(h^2) && \text{local expansion} \\
\frac{f(x+h)-f(x)}{h} &= f'(x) + O(h) && \text{divide by } h \\
\lim_{h\to 0}\frac{f(x+h)-f(x)}{h} &= f'(x) && ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
\Delta f &\approx f'(x)\,\Delta x && \text{linear approximation} \\
f(x+\Delta x) &\approx f(x) + f'(x)\,\Delta x && \text{prediction step} \\
  	ext{error} &= O((\Delta x)^2) && ${tailComment}
\end{aligned}`;
  }

  if (/matrix|vector|linear algebra|eigen|basis|dimension/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
A\mathbf{x} &= \lambda\mathbf{x} && \text{eigenvector relation} \\
(A-\lambda I)\mathbf{x} &= \mathbf{0} && \text{move to one side} \\
&&& ${correction}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
\det(A-\lambda I) &= 0 && \text{characteristic equation} \\
\lambda_1,\dots,\lambda_n &\text{ solve this polynomial} && \text{eigenvalue candidates} \\
&&& ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
\mathbf{x} &= c_1\mathbf{v}_1 + \cdots + c_n\mathbf{v}_n && \text{expand in eigenbasis} \\
A^k\mathbf{x} &= c_1\lambda_1^k\mathbf{v}_1 + \cdots + c_n\lambda_n^k\mathbf{v}_n && \text{power action} \\
&&& ${tailComment}
\end{aligned}`;
  }

  if (/probability|statistics|random|variance|expectation|distribution/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
\mathbb{E}[X] &= \sum_x x\,P(X=x) && \text{weighted mean} \\
\mu &= \mathbb{E}[X] && \text{notation} \\
&&& ${correction}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
\mathrm{Var}(X) &= \mathbb{E}[(X-\mu)^2] && \text{definition} \\
&= \mathbb{E}[X^2] - \mu^2 && \text{expanded form} \\
&&& ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
z &= \frac{x-\mu}{\sigma} && \text{standardize} \\
P(X\le x) &= \Phi(z) && \text{map to the normal CDF} \\
&&& ${tailComment}
\end{aligned}`;
  }

  if (/physics|force|energy|momentum|motion|wave|electric|field/.test(text)) {
    if (phase === 1) {
      return String.raw`\begin{aligned}
F &= ma && \text{Newton's second law} \\
a &= \frac{\Delta v}{\Delta t} && \text{kinematics link} \\
&&& ${correction}
\end{aligned}`;
    }
    if (phase === 2) {
      return String.raw`\begin{aligned}
W &= F\,d\cos\theta && \text{work by constant force} \\
\Delta K &= W && \text{work-energy theorem} \\
&&& ${tailComment}
\end{aligned}`;
    }
    return String.raw`\begin{aligned}
p &= m v && \text{momentum definition} \\
\Delta p &= F\,\Delta t && \text{impulse relation} \\
&&& ${tailComment}
\end{aligned}`;
  }

  if (phase === 1) {
    return String.raw`\begin{aligned}
	ext{Claim: } & ${String(concept || topic || 'the result')} && \text{goal} \\
	ext{Step 1: } & \text{state assumptions and definitions} && \text{setup} \\
	ext{Step 2: } & \text{derive the first relation} && ${correction}
\end{aligned}`;
  }
  if (phase === 2) {
    return String.raw`\begin{aligned}
	ext{Given } & \text{the previous relation} && \text{continue} \\
	ext{Step 3: } & \text{transform into an equivalent form} && \text{algebra / logic} \\
	ext{Step 4: } & \text{isolate the target expression} && ${tailComment}
\end{aligned}`;
  }
  return String.raw`\begin{aligned}
	ext{Final step: } & \text{substitute back and simplify} && \text{assemble result} \\
	ext{Conclusion: } & ${String(concept || topic || 'the result')} && \text{proved} \\
&&& ${tailComment}
\end{aligned}`;
}

module.exports = {
  makeFallbackLearningPath,
  makeFallbackLevelConcepts,
  makeFallbackSlide,
  makeFallbackRecommendation,
  makeFallbackCoachReply,
  makeFallbackTable,
  makeFallbackProofLatex
};
