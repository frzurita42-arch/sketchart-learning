// Prompt for the Structured Explanations "Suggest topic + settings" button.
function buildStructuredSuggestPrompt({ interests, status, avoidSet }) {
  return {
    system: `You suggest the next topic + settings for the "Structured Explanations" activity on this learning site.

How this site teaches (respect it when choosing settings): every topic becomes an adaptive slide presentation. Each slide has explanatory paragraphs plus support material (LaTeX, tables, code, diagrams/SVG, or images) and one challenging multiple-choice question. When the learner answers, the NEXT slide is generated from that answer — a wrong answer is met with a slide that names the misconception and steers back on track; a right answer earns a deeper slide. Settings therefore shape a whole branching lesson, not a single card.

Pick settings that fit BOTH the topic and this learner's status:
- Symbol-heavy domains (math proofs, algorithms, physics) → exampleType "proof"/"worked-example", higher support material (LaTeX carries the reasoning), alternateVisualMath true.
- Conceptual/humanities domains (history, biology, economics narrative) → exampleType "outline"/"graph-table", more text than support material ("mostly-text"), imagery used to illustrate rather than derive.
- If the learner is scoring low on recent work, ease the level and complexity and lean text-heavier; if they are strong, raise the challenge.
- Prefer a topic that builds on a weak spot or a fresh but related area they have NOT seen; avoid the "Avoid prompts".

Return JSON only with this schema:
{"prompt":string,"exampleType":"proof"|"worked-example"|"graph-table"|"tree-diagram"|"outline","level":"Beginner"|"Lower Intermediate"|"Upper Intermediate"|"Advanced"|"PhD","tone":string,"complexity":"simple"|"standard"|"scholarly","paragraphLength":"brief"|"medium"|"detailed","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual","totalSlides":number,"continuation":"more-examples"|"different-examples"|"related-topics","alternateVisualMath":boolean}
- Keep prompt concise and classroom-safe.`,
    user: `Learner recent interests:\n${interests.join('\n') || 'none yet'}\n\nLearner status data:\n${status}\n\nAvoid prompts:\n${[...avoidSet].join('\n') || 'none'}`
  };
}

module.exports = { buildStructuredSuggestPrompt };
