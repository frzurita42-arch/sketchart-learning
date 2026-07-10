// Prompt for refreshing the concepts of a single level in a learning path.
function buildLevelRefreshPrompt({ level, wanted, topic, guidance, avoid, recent }) {
  return {
    system: `You are a curriculum designer. Return JSON only:
{"level":string,"description":string,"concepts":[{"name":string,"blurb":string}]}
Rules:
- level must be exactly "${level}".
- exactly ${wanted} concepts.
- Keep concepts strictly at ${level} difficulty.
- concepts must be different from the avoid list.
- blurb max 15 words each.`,
    user: `Topic: ${topic}\n${guidance ? `Guidance: ${guidance}\n` : ''}Avoid concepts:\n${avoid.join('\n') || 'none'}\n\nRecent learner history:\n${recent || 'none yet'}\n\nBalance: reinforce this learner's weak spots while still surfacing globally relevant, timely angles.`
  };
}

module.exports = { buildLevelRefreshPrompt };
