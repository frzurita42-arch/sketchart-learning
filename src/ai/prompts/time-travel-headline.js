// Prompt for the Time Travel activity's "Random headline" seed.
function buildTimeTravelHeadlinePrompt({ normalizedPeriod, interests, status, trendSeeds, avoidSet }) {
  return {
    system: `You invent the seed headline for the "Time Travel" activity on this learning site.

How this site teaches: the headline becomes an adaptive slide presentation set in a chosen era. Each slide explains real concepts (causes, impacts, practical solutions) with support material and one challenging multiple-choice question; the learner's answer decides the next slide (wrong → correct the misconception, right → go deeper). So the headline should open a genuinely teachable, problem-solving scenario — not just a flashy title.

Personalize to the learner's status below: lean toward their interests and weak spots so the resulting lesson reinforces what they need, while staying fresh (avoid repeating the "Avoid headlines").

Return JSON only: {"headline":string}
Rules:
- One compelling, classroom-safe news-style headline set in the ${normalizedPeriod}.
- Educational and problem-solving oriented; 7-16 words; no sensational violence.`,
    user: `Learner interests:\n${interests.join('\n') || 'none yet'}\n\nLearner status data:\n${status}\n\nTrend seeds:\n${trendSeeds.join('\n')}\n\nAvoid headlines:\n${[...avoidSet].join('\n') || 'none'}`
  };
}

module.exports = { buildTimeTravelHeadlinePrompt };
