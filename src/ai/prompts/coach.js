// Prompts for the coach: end-of-lesson recommendation and the free-form chat.

// End-of-lesson grading + recommendations.
function buildRecommendPrompt({ topic, concept, level, correct, total, durationSec, history, slides }) {
  return {
    system: `You are a learning coach. Given a learner's quiz performance, respond ONLY with JSON:
{"summary": string (2 sentences, warm, specific), "questionSummary": [string, string, string], "answerSummary": [string, string, string], "aiNotes": [string, string, string], "recommendations": [string, string, string], "nextConcepts": [{"name": string, "level": string}]}
Recommendations must reference the actual mistakes made. questionSummary should list the main question themes in this lesson. answerSummary should list the learner's answer patterns or choices. aiNotes should compare this lesson against the recent history below and explain the learner's progress in the same field, with specific next steps. nextConcepts: 2-3 concepts to study next.`,
    user: `Topic: ${topic}, concept: ${concept}, level: ${level}. Score ${correct}/${total} in ${durationSec}s.\n\nRecent lessons in the same field:\n${history.filter(g => g.topic === topic).map(g => `- ${g.finishedDate || g.finishedAt}: ${g.concept} (${g.level}) ${g.correct}/${g.total}`).join('\n') || 'none yet'}\n\nAnswers:\n` +
      slides.map((s, i) => `${i + 1}. "${s.question}" → chose "${s.chosen}" (${s.correct ? 'correct' : `wrong — misconception: ${s.misconception || 'unknown'}`})`).join('\n')
  };
}

// System message for the coach chat. `progress` is a compact array of recent
// games; `username` is the learner's name.
function buildCoachChatSystem({ progress, username }) {
  return `You are the SketchLearn coach: a friendly guide inside an adaptive learning website. The site works like this: the learner picks a topic (or types a custom one), the AI builds a learning path across Beginner → Lower Intermediate → Upper Intermediate → Advanced → PhD levels, the learner picks a concept and tunes settings (number of slides, tone, text complexity, paragraph length, and how visual the slides are), then plays through AI-generated slides each ending in a comprehension quiz; wrong answers branch into remediation slides, right answers drill deeper; the final slide shows their stats.
Here is this learner's progress spreadsheet (their recent completed activities), as JSON:
${JSON.stringify(progress, null, 1)}
Use it to give concrete, personal guidance: point out strong/weak topics, suggest which concept and level to try next, and explain which settings to use. Keep replies short and warm (under 150 words unless asked for more). The learner is "${username}".`;
}

module.exports = { buildRecommendPrompt, buildCoachChatSystem };
