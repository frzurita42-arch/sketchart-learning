/* Shared singletons: the app state object, constant pools, and the root
 * DOM mounts. Every view/activity/flow imports what it needs from here. */

export const $app = document.getElementById('app');
export const $topbar = document.getElementById('topbar');
export const $footer = document.getElementById('site-footer');

export const PRESET_TOPICS = ['Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Literature', 'Programming', 'Economics', 'Music Theory', 'Astronomy', 'Psychology'];
export const LEVELS = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
export const TONES = ['Friendly lecture', 'Casual conversation', 'Hopeful & encouraging', 'Pessimistic & cautionary', 'Humorous', 'Storytelling', 'Socratic questioning'];

export const state = {
  topic: null,
  path: null,
  homeTopics: [],
  homeSuggestion: null,
  timeTravel: {
    headline: '',
    period: 'future',
    level: 'Lower Intermediate',
    complexity: 'standard',
    paragraphLength: 'medium',
    paragraphCount: 3,
    imageDensity: 'balanced',
    totalSlides: 7,
    tone: 'Storytelling'
  },
  latexLab: {
    prompt: '',
    exampleType: 'proof',
    level: 'Upper Intermediate',
    tone: 'Friendly lecture',
    complexity: 'standard',
    paragraphLength: 'medium',
    imageDensity: 'balanced',
    totalSlides: 8,
    continuation: 'related-topics',
    alternateVisualMath: true
  },
  suggestedSettings: null,
  suggestedGuidance: '',
  concept: null,
  level: null,
  settings: null,
  game: null,
  chat: [{ role: 'assistant', content: "Hi! I'm your SketchLearn coach. I can see your progress spreadsheet and help you pick what to study next, or explain how to use the site. What are you curious about?" }]
};
