// Prompt for the home "Suggested topic" pair (2 suggestions + recommended settings).
function buildSuggestedTopicPrompt({ triggerTopic, recent, sameField, trendSeeds, avoidSet }) {
  return {
    system: `You are a study coach. Return JSON only with this exact schema:
{"suggestions":[{"topic":string,"why":string,"honorableMentions":[string,string,string],"settings":{"level":string,"totalSlides":number,"paragraphLength":"brief"|"medium"|"detailed","paragraphCount":number,"tone":string,"complexity":"simple"|"standard"|"scholarly","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual"},"customMessage":string},{"topic":string,"why":string,"honorableMentions":[string,string,string],"settings":{"level":string,"totalSlides":number,"paragraphLength":"brief"|"medium"|"detailed","paragraphCount":number,"tone":string,"complexity":"simple"|"standard"|"scholarly","imageDensity":"text-only"|"mostly-text"|"balanced"|"mostly-visual"},"customMessage":string}]}
Rules:
- Exactly 2 suggestions.
- Gear suggestions toward the learner's recent interests and solving real problems.
- Blend current global events/trends with the learner's progression history.
- Topics must be short, classroom-safe, and distinct.
- "why" must be concise (max 2 sentences).
- settings are recommended defaults and must remain editable in the app.
- totalSlides 2-20 and paragraphCount 1-7.`,
    user: `Trigger topic from home interaction (if any): ${triggerTopic || 'none'}\n\nLearner recent history:\n${recent.map(g => `- ${g.finishedDate || g.finishedAt}: ${g.topic} / ${g.concept} (${g.level}) score ${g.correct}/${g.total}`).join('\n') || 'none yet'}\n\nInterest progression hints:\n${sameField.join('\n') || 'none'}\n\nCurrent trend seeds to consider:\n${trendSeeds.join('\n')}\n\nAvoid these topic names:\n${[...avoidSet].join('\n') || 'none'}`
  };
}

module.exports = { buildSuggestedTopicPrompt };
