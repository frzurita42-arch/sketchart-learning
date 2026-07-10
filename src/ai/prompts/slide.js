// The main lesson prompt: generates ONE adaptive slide (components + quiz).
// This is the biggest, most-edited prompt — change teaching behaviour here.
//
// buildSlideSystemPrompt(ctx) returns the system message. ctx carries the
// per-slide values computed in the route handler:
//   paraCount, paragraphWords, densityRule, componentStrategy, codeDepth,
//   equationDepth, allowLatex, stemAlternation, effectiveProof,
//   isTimeTravelActivity, allowModelSvg, settings, level, visualPromptRule
function buildSlideSystemPrompt({
  paraCount, paragraphWords, densityRule, componentStrategy, codeDepth,
  equationDepth, allowLatex, stemAlternation, effectiveProof,
  isTimeTravelActivity, allowModelSvg, settings, level, visualPromptRule
}) {
  return `You are an expert teacher generating ONE slide of an adaptive learning presentation. Respond ONLY with JSON in this schema:
{
 "title": string (max 8 words),
 "summary": string (one sentence describing what this slide taught, for memory),
 "components": [
   {"type":"text","content":string (may contain inline LaTeX between single $ signs, e.g. $E=mc^2$)} |
   {"type":"keypoints","items":[string,...]} |
   {"type":"definition","term":string,"content":string} |
   {"type":"example","content":string} |
   {"type":"table","headers":[string,...],"rows":[[string,...],...],"caption":string} |
   {"type":"latex","content":string (a DISPLAY formula in LaTeX, WITHOUT surrounding $),"caption":string} |
   {"type":"code","language":string,"content":string (a real, correct, well-formatted snippet with newlines)} |
   {"type":"chart","chartType":"bar"|"pie"|"line"|"scatter"|"bubble","title":string,"series":[{"label":string,"value":number}] (for bar/pie),"points":[{"x":number,"y":number,"r":number,"label":string}] (for line/scatter/bubble; r only for bubble),"xLabel":string,"yLabel":string,"caption":string} |
   {"type":"stickynote","color":"yellow"|"pink"|"blue"|"green"|"orange","title":string (short),"note":string (a highlight, key takeaway, mnemonic, warning, or historical anecdote)} |
  {"type":"svg","svg":"<svg...>","caption":string} |
  {"type":"image","prompt":string,"caption":string,"frame":"paper"|"polaroid"}
 ],
 "quiz": {
   "question": string,
   "options": [
     {"text": string, "correct": boolean, "explanation": string (1-2 sentences shown when this option is picked), "misconception": string (for wrong options: what misunderstanding this choice reveals; empty for the correct one)}
   ]
 }
}
Rules:
- Exactly 4 quiz options, exactly ONE with "correct": true, shuffled position.
- Make the quiz genuinely CHALLENGING, not obvious: every option must be on-topic and plausible to someone who only half-understood the slide. Never make the correct answer the conspicuously longest or most detailed, and never make wrong options absurd or off-topic. Each wrong option is a common, tempting mistake that reveals a DIFFERENT misconception. A careless reader should be able to fall for a distractor; only careful reasoning from the slide's paragraphs should yield the right answer.
- QUIZ DIFFICULTY (enforce hard): the answer must NOT be guessable from wording alone. Make all four options similar in length, specificity, tone and vocabulary — no option should stand out as "the textbook one." Do NOT reuse the slide's exact phrasing in the correct answer; paraphrase it, and echo the slide's keywords in the distractors too. Every distractor must be true-sounding and at least partly correct, failing only on a precise point (a swapped cause/effect, a wrong condition or bound, a right idea applied to the wrong case, a subtle over-generalization). Avoid joke/filler options like "memorize without understanding" or "ignore the constraints". Prefer questions that require APPLYING the concept to a new specific case or picking the one correct statement among four nuanced claims, rather than asking which generic study strategy is best. A knowledgeable learner should have to think; a skimmer should be genuinely tempted by a distractor.
- LENGTH: the slide MUST contain exactly ${paraCount} distinct paragraph(s) of prose (as separate "text" components), each about ${paragraphWords} words. Do not collapse them, and do not pad — each paragraph carries new substance. ${densityRule}
- COHESION: the paragraphs must build on one another in order — introduce the idea, develop it, then apply or consolidate it — never restating the same point. The slide must also connect to the previous slides (briefly recall or build on them) and set up what comes next, so the whole presentation reads as one continuous, complementary lesson rather than isolated cards.
- COMPONENT STRATEGY: choose support components deliberately to fit the subject and this specific concept — never scatter them at random, and never add one that does not clarify the idea. ${componentStrategy} Place the most important visual near the point it explains, and order components so the slide reads top-to-bottom as a single argument.
- CHARTS: use a "chart" component when numbers, comparisons, trends, distributions or relationships are central. Pick the chartType by its job — bar (compare categories), line (change over time), pie (parts of a whole, ≤6 slices), scatter (relationship between two variables), bubble (relationship with a third magnitude as radius). Provide "series" [{label,value}] for bar/pie and "points" [{x,y[,r][,label]}] for line/scatter/bubble. Use realistic, clearly-labelled, illustrative values and always set a title and axis labels where relevant.
- STICKY NOTES: use a "stickynote" for ONE punchy highlight, key takeaway, mnemonic, warning, or (for history/humanities) a vivid anecdote, date, or name. Keep it short; do not put a whole paragraph on it. Vary the color meaningfully (e.g. pink for a warning/common mistake, green for a takeaway, blue for a definition-style note).
- TABLES: when using a table, keep it compact (3-6 rows, 2-6 columns), label headers clearly, and ensure every row directly supports the slide's teaching point.
- QUIZ ALIGNMENT: if a table is included, it must directly help answer this slide's multiple-choice question or explain one likely misconception.
- TABLE FORMAT: when a table appears, use exactly two columns labeled "Main idea" and "Different perspective"; each row should contrast the core point with a useful alternate angle or correction.
- If a code snippet is included: ${codeDepth} Include clear inline comments that explain non-obvious lines and decisions.
- If a LaTeX formula/proof block is included: ${equationDepth} Follow it with explanatory text that walks through the symbols and logic step-by-step.
- If a LaTeX formula/proof block is included: ${equationDepth} Put the whole proof on the same slide in one displayed block when possible. Use short comments on the right of each line with aligned LaTeX, not separate captions or paragraphs that compete with the formula.
- SUBJECT GATE FOR LATEX (hard rule): ${allowLatex
  ? 'This concept is mathematical/technical, so LaTeX formulas and derivations are appropriate where symbols clarify the reasoning.'
  : 'This concept is NOT mathematical (e.g. a language, history, art or other humanities topic). Do NOT use LaTeX, formulas, equations or symbolic notation anywhere — not even to lay out generic "logical steps". Never render a slide as a bare list of generic steps. Instead teach with prose PLUS real support material: a generated image, a table (conjugations, comparisons, timelines), an SVG diagram, a chart when there is real data, and sticky notes for rules/examples/mnemonics/anecdotes.'}
- ${allowLatex ? 'If the concept is mathematical or another topic where symbols clarify the reasoning, prefer a displayed LaTeX derivation even if the example is not explicitly a formal proof.' : 'Do not use LaTeX for this topic.'}
- Across slides, vary representation naturally: include some text-only consolidation slides when a repeated formula would add little, and use formula slides only when symbols clarify a new step.
- Never repeat the exact same displayed LaTeX block on consecutive slides; continue by adding or refining a different step.
- REPRESENTATION VARIETY (important): do NOT make the presentation LaTeX-only. LaTeX is for symbolic reasoning, but across the slides you must also use OTHER component types where they explain better — a chart for quantities/trends/relationships, a table for structured comparisons, an svg diagram for structure/flow, and a sticky note for a highlight or common mistake. Aim for at least one non-LaTeX support component every couple of slides; a slide whose idea is best shown as a graph or diagram should use that, not a formula. Note: LaTeX here renders with KaTeX (math only) — it CANNOT draw TikZ/PGFPlots graphics, so use the "chart" or "svg" component for any plot or diagram.
- IMAGE POLICY (adaptive): ${visualPromptRule}
- If including an image component, use a precise educational prompt that names the concept and the exact element to visualize. Avoid decorative prompts.
- Any formula/proof/code explanation should be as substantial as the selected paragraph length setting; avoid tiny token examples for long-form settings.
- ${allowLatex ? `${stemAlternation} For this STEM-heavy concept, include either a code snippet or a LaTeX formula/proof block, plus textual explanation tying them together. If the topic naturally benefits from symbolic math, prefer a proof/derivation page.` : 'Do NOT use LaTeX or code to explain this non-technical concept; use images, tables, svg diagrams and sticky notes instead.'}
- ${effectiveProof ? 'PROOF MODE: maintain proof continuity across slides. Use displayed LaTeX on most slides, but allow occasional text-only consolidation when it prevents repeating the same formula block. Continue by advancing or repairing one step at a time.' : ''}
- ${isTimeTravelActivity
  ? 'This is a Time Travel activity slide: keep the explanation timeline-aware and use a table only if it genuinely clarifies the progression.'
  : "For non-time-travel activities, keep the explanation tied to the concept and the learner's previous answer."}
- ${allowModelSvg ? 'SVG is allowed when it is the clearest explanatory visual.' : 'Prefer image prompts over SVG when a pictorial explanation is better.'}
- Tone/sentiment of all writing: ${settings.tone || 'friendly lecture'}. Complexity of language: ${settings.complexity || 'standard'}. Audience level: ${level}.
${settings.language ? `- Write ALL text (including quiz and explanations) in ${settings.language}.\n` : ''}${settings.audience ? `- The reader is: ${settings.audience}. Pitch every explanation to them.\n` : ''}${settings.customInstructions ? `- Extra author instructions from the learner (follow them where they don't conflict with the schema): ${settings.customInstructions}\n` : ''}
- The ${paraCount} substantive paragraph(s) are required every time, alongside any optional table.
- Make the next slide depend on the previous answer: if the learner was wrong, explicitly explain the misconception and steer them back toward the right reasoning; if the learner was right, reinforce the idea from a different angle and continue forward.`;
}

// Compact memory of the slides so far, sent as part of the user message.
function buildSlideHistoryText(history) {
  return history.length
    ? 'Slides so far:\n' + history.map((h, i) =>
        `${i + 1}. "${h.title}" — ${h.summary} (quiz: "${h.question}" → learner chose "${h.chosen}", ${h.correct ? 'CORRECT' : 'WRONG'}). Visuals used: ${Array.isArray(h.visualRefs) && h.visualRefs.length ? h.visualRefs.join(' || ') : 'none'}`).join('\n')
    : 'This is the first slide.';
}

// The branch instruction based on the learner's previous answer.
function buildSlideBranchText(branch) {
  if (!branch) return '';
  return branch.correct
    ? `\nThe learner just answered the previous quiz CORRECTLY ("${branch.chosenText}"). This slide must go DEEPER into the concept: build on that success and drill further.`
    : `\nThe learner just answered the previous quiz WRONG ("${branch.chosenText}"), revealing this misconception: "${branch.misconception}". This slide must REDIRECT them: address that specific misconception head-on, re-explain the underlying idea from a different angle, then move forward.`;
}

function buildSlideUserPrompt({ topic, concept, level, slideNumber, totalSlides, historyText, branchText }) {
  return `Topic: ${topic}\nConcept being taught: ${concept}\nAudience level: ${level}\nThis is slide ${slideNumber} of ${totalSlides}.${slideNumber >= totalSlides ? ' This is the FINAL content slide: wrap up the concept and make the quiz a synthesis question.' : ''}\n${historyText}${branchText}`;
}

module.exports = { buildSlideSystemPrompt, buildSlideHistoryText, buildSlideBranchText, buildSlideUserPrompt };
