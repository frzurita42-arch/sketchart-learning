/* Central configuration: env loading, provider flags, shared constants.
 * Everything env-derived lives here so the rest of the backend imports a value
 * instead of reading process.env or recomputing a flag. Required first at boot. */
const fs = require('fs');
const path = require('path');

// Project root (this file lives in src/, so go one level up).
const ROOT_DIR = path.join(__dirname, '..');

// ---------- tiny .env loader (no dependency needed) ----------
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function hasConfiguredKey(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return !/(your[-_ ]?key|sk-your-key-here|replace-me|placeholder)/i.test(v);
}

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const SUGGESTED_STORE_FILE = 'suggested_topics.json';
const HOME_TOPICS_STORE_FILE = 'home_topics.json';

const GLOBAL_TREND_SEEDS = [
  'AI safety and alignment',
  'Climate adaptation systems',
  'Public health data literacy',
  'Space economy basics',
  'Cybersecurity for citizens',
  'Water resilience engineering',
  'Energy storage breakthroughs',
  'Misinformation detection methods',
  'Food security analytics',
  'Disaster response logistics'
];

const DEFAULT_SUGGESTION_PAIR = [
  {
    topic: 'Climate adaptation systems',
    why: 'This connects real global pressure points to practical problem-solving skills that stay relevant over time.',
    honorableMentions: ['Water resilience engineering', 'Disaster response logistics', 'Energy storage breakthroughs'],
    settings: {
      level: 'Upper Intermediate',
      totalSlides: 7,
      paragraphLength: 'medium',
      paragraphCount: 3,
      tone: 'friendly lecture',
      complexity: 'standard',
      imageDensity: 'balanced'
    },
    customMessage: 'Frame each slide around a real-world constraint and end with one actionable solution step.'
  },
  {
    topic: 'Misinformation detection methods',
    why: 'This sharpens critical thinking for current-event information overload and teaches decision-quality habits.',
    honorableMentions: ['Public health data literacy', 'AI safety and alignment', 'Cybersecurity for citizens'],
    settings: {
      level: 'Lower Intermediate',
      totalSlides: 6,
      paragraphLength: 'brief',
      paragraphCount: 3,
      tone: 'Socratic questioning',
      complexity: 'standard',
      imageDensity: 'mostly-text'
    },
    customMessage: 'Use one current headline-style claim per slide and test it with a simple verification checklist.'
  }
];

const DEFAULT_HOME_TOPIC_POOL = [
  'Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Literature', 'Programming',
  'Economics', 'Music Theory', 'Astronomy', 'Psychology', 'Climate adaptation systems',
  'Public health data literacy', 'Cybersecurity for citizens', 'Energy storage breakthroughs',
  'Water resilience engineering', 'Food security analytics', 'Disaster response logistics',
  'Misinformation detection methods', 'Data storytelling', 'Systems thinking', 'AI safety and alignment', 'Space economy basics'
];

const dbEnabled = hasConfiguredKey(DATABASE_URL);

// Optional: Google Gemini. One key powers BOTH the lesson text (replacing DeepSeek)
// and real generated images (Gemini's native image models). Set GEMINI_API_KEY to use it.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const forceFallback = /^(1|true|yes)$/i.test(String(process.env.SKETCHLEARN_FORCE_FALLBACK || '').trim());
const geminiEnabled = !forceFallback && hasConfiguredKey(GEMINI_API_KEY);
const deepseekEnabled = !forceFallback && hasConfiguredKey(DEEPSEEK_API_KEY);

// Optional image-generation backend (see .env.example). Priority: an explicit
// OpenAI-compatible image provider, else Gemini's image model, else no images.
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;
const IMAGE_API_URL = process.env.IMAGE_API_URL || 'https://api.openai.com/v1/images/generations';
const IMAGE_API_MODEL = process.env.IMAGE_API_MODEL || 'gpt-image-1';
const imageEnabled = !forceFallback && (hasConfiguredKey(IMAGE_API_KEY) || geminiEnabled);

// Optional: use Anthropic's Claude to DRAW each slide's SVG (Claude writes far more
// accurate, well-labelled sketch diagrams than a text model). DeepSeek still writes
// the lesson text + quiz; when a key is set, Claude illustrates each slide fresh,
// using that slide's concept, level, and the learner's progress. Falls back to
// DeepSeek's own SVG when unset.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const claudeSvgEnabled = !!ANTHROPIC_API_KEY;

// ---------- sessions (signed stateless auth tokens) ----------
// Never sign tokens with a secret that ships in the repo. In production a real
// AUTH_TOKEN_SECRET is required; otherwise anyone could forge an admin token.
const AUTH_TOKEN_SECRET = (() => {
  if (hasConfiguredKey(process.env.AUTH_TOKEN_SECRET)) return process.env.AUTH_TOKEN_SECRET;
  if (hasConfiguredKey(DATABASE_URL)) {
    console.warn('WARNING: AUTH_TOKEN_SECRET not set — falling back to DATABASE_URL as the token-signing secret. Set a dedicated AUTH_TOKEN_SECRET for production.');
    return DATABASE_URL;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: AUTH_TOKEN_SECRET is not set. Refusing to start in production with the public default secret. Set a strong, random AUTH_TOKEN_SECRET (e.g. `openssl rand -hex 32`).');
    process.exit(1);
  }
  console.warn('WARNING: AUTH_TOKEN_SECRET not set — using an insecure local-development default. Never deploy without setting AUTH_TOKEN_SECRET.');
  return 'local-dev-session-secret';
})();
const AUTH_TOKEN_TTL_SEC = Math.max(300, parseInt(process.env.AUTH_TOKEN_TTL_SEC, 10) || (60 * 60 * 24 * 30));

module.exports = {
  ROOT_DIR,
  hasConfiguredKey,
  PORT,
  DEEPSEEK_API_KEY,
  DEEPSEEK_URL,
  DATABASE_URL,
  dbEnabled,
  SUGGESTED_STORE_FILE,
  HOME_TOPICS_STORE_FILE,
  GLOBAL_TREND_SEEDS,
  DEFAULT_SUGGESTION_PAIR,
  DEFAULT_HOME_TOPIC_POOL,
  GEMINI_API_KEY,
  GEMINI_API_BASE,
  GEMINI_TEXT_MODEL,
  GEMINI_IMAGE_MODEL,
  forceFallback,
  geminiEnabled,
  deepseekEnabled,
  IMAGE_API_KEY,
  IMAGE_API_URL,
  IMAGE_API_MODEL,
  imageEnabled,
  ANTHROPIC_API_KEY,
  ANTHROPIC_API_URL,
  ANTHROPIC_MODEL,
  claudeSvgEnabled,
  AUTH_TOKEN_SECRET,
  AUTH_TOKEN_TTL_SEC
};
