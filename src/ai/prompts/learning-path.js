// Prompt for building a full learning path (curriculum) for a topic.
// Edit this file to change how the AI structures levels/concepts for a path.
function buildLearningPathPrompt({ wanted, topic, guidance, historyLine, freshSeed }) {
  return {
    system: `You are a curriculum designer. Given a study topic, produce a learning path as JSON with this exact schema:
{"topic": string, "overview": string (2 sentences max), "levels": [{"level": string, "description": string (1 sentence), "concepts": [{"name": string, "blurb": string (max 15 words)}]}]}
Include ONLY these levels, in this order: ${wanted.join(', ')}. Give 4-6 concrete, teachable concepts per level, ordered from first-to-learn to last. Respond with JSON only.`,
    user: `Topic: ${topic}` + (guidance ? `\nLearner guidance/request (adapt the path to this): ${guidance}` : '') + historyLine +
      (freshSeed ? `\n(Offer a genuinely fresh selection of concepts this time — vary them from a typical default. Variation token: ${freshSeed}.)` : '')
  };
}

module.exports = { buildLearningPathPrompt };
