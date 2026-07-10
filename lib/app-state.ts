/* Shared client singletons: constant pools + the mutable app state object.
 * Ported from public/js/core/state.js. Kept as a module-level singleton (like
 * the legacy SPA) so every view/activity/flow reads and mutates the same
 * object; React re-renders are driven by the AppContext `rerender()` tick. */

export const PRESET_TOPICS = ['Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Programming', 'Economics', 'Music Theory', 'Astronomy', 'Psychology', 'Literature'];
export const LEVELS = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
export const TONES = ['Friendly lecture', 'Casual conversation', 'Hopeful & encouraging', 'Pessimistic & cautionary', 'Humorous', 'Storytelling', 'Socratic questioning'];

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export const initialCoachGreeting: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm your SketchLearn coach. I can see your progress spreadsheet and help you pick what to study next, or explain how to use the site. What are you curious about?",
};

export interface AppState {
  topic: string | null;
  path: any;
  homeTopics: string[];
  homeSuggestion: any;
  timeTravel: any;
  latexLab: any;
  suggestedSettings: any;
  suggestedGuidance: string;
  concept: string | null;
  level: string | null;
  settings: any;
  game: any;
  chat: ChatMessage[];
  // Path-flow transient state (loading spinner + error, mirroring the legacy
  // imperative loadPath()).
  pathLoading?: string | null;
  pathError?: string | null;
  pathRequest?: any;
}

export const appState: AppState = {
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
    tone: 'Storytelling',
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
    alternateVisualMath: true,
  },
  suggestedSettings: null,
  suggestedGuidance: '',
  concept: null,
  level: null,
  settings: null,
  game: null,
  chat: [initialCoachGreeting],
};
