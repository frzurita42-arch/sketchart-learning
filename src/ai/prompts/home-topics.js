// Prompt for generating the pool of home-page topic chips for a learner.
function buildHomeTopicPoolPrompt({ wantedPool, triggerTopic, learned, trendSeeds, avoidList }) {
  return {
    system: `Return JSON only:
{"topics":[{"name":string,"why":string}]}
Rules:
- Exactly ${wantedPool} topics.
- Blend learner interests with current global trends.
- Favor practical, problem-solving learning themes.
- Topic names must be short, classroom-safe, and distinct.`,
    user: `Trigger topic from home interaction (if any): ${triggerTopic || 'none'}\n\nLearner recent studies:\n${learned.join('\n') || 'none yet'}\n\nCurrent trend seeds:\n${trendSeeds.join('\n')}\n\nAvoid these topic names:\n${avoidList.join('\n') || 'none'}`
  };
}

module.exports = { buildHomeTopicPoolPrompt };
