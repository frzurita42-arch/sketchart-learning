/* SketchLearn server: auth + JSON storage + DeepSeek AI proxy */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- tiny .env loader (no dependency needed) ----------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DATA_DIR = path.join(__dirname, 'data');
const GEN_DIR = path.join(DATA_DIR, 'generated');

function hasConfiguredKey(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return !/(your[-_ ]?key|sk-your-key-here|replace-me|placeholder)/i.test(v);
}

fs.mkdirSync(GEN_DIR, { recursive: true });

function parseModelJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty JSON response from model');

  // Some providers occasionally wrap JSON in ```json code fences.
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const extractBalanced = (src) => {
    const firstObj = src.indexOf('{');
    const firstArr = src.indexOf('[');
    const start = (firstObj === -1) ? firstArr : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
    if (start === -1) return null;
    const open = src[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return null;
  };

  const candidates = [unfenced, extractBalanced(unfenced)].filter(Boolean);
  let lastErr = null;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch (e) { lastErr = e; }
  }
  throw new Error(`Model returned invalid JSON: ${lastErr ? lastErr.message : 'parse failed'}`);
}

// ---------- JSON file storage ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function recentUserGames(username, limit = 20) {
  return readJSON('games.json', [])
    .filter(g => g.username === username)
    .slice(-limit);
}

// ---------- users ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, salt, passwordHash: hashPassword(password, salt), role, createdAt: new Date().toISOString() };
}
let users = readJSON('users.json', null);
if (!users) {
  users = [makeUser('admin', '123456', 'admin')];
  writeJSON('users.json', users);
  console.log('Seeded default admin user (admin / 123456)');
}

// ---------- sessions (auth tokens, in memory) ----------
const tokens = new Map(); // token -> username

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// serve the vendored KaTeX build (CSS, JS, fonts) for offline LaTeX rendering
app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist')));

// Optional: Google Gemini. One key powers BOTH the lesson text (replacing DeepSeek)
// and real generated images (Gemini's native image models). Set GEMINI_API_KEY to use it.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const geminiEnabled = hasConfiguredKey(GEMINI_API_KEY);
const deepseekEnabled = hasConfiguredKey(DEEPSEEK_API_KEY);

// Optional image-generation backend (see .env.example). Priority: an explicit
// OpenAI-compatible image provider, else Gemini's image model, else no images.
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;
const IMAGE_API_URL = process.env.IMAGE_API_URL || 'https://api.openai.com/v1/images/generations';
const IMAGE_API_MODEL = process.env.IMAGE_API_MODEL || 'gpt-image-1';
const imageEnabled = hasConfiguredKey(IMAGE_API_KEY) || geminiEnabled;

// Optional: use Anthropic's Claude to DRAW each slide's SVG (Claude writes far more
// accurate, well-labelled sketch diagrams than a text model). DeepSeek still writes
// the lesson text + quiz; when a key is set, Claude illustrates each slide fresh,
// using that slide's concept, level, and the learner's progress. Falls back to
// DeepSeek's own SVG when unset.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const claudeSvgEnabled = !!ANTHROPIC_API_KEY;

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const username = tokens.get(token);
  if (!username) return res.status(401).json({ error: 'Not signed in' });
  req.user = users.find(u => u.username === username);
  if (!req.user) return res.status(401).json({ error: 'Unknown user' });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- auth endpoints ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username);
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, user.username);
  res.json({ token, username: user.username, role: user.role });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  tokens.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ---------- user management ----------
app.get('/api/users', auth, adminOnly, (req, res) => {
  const games = readJSON('games.json', []);
  res.json(users.map(u => ({
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    gamesPlayed: games.filter(g => g.username === u.username).length
  })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (users.some(u => u.username === username)) return res.status(409).json({ error: 'User already exists' });
  users.push(makeUser(username.trim(), password, role === 'admin' ? 'admin' : 'user'));
  writeJSON('users.json', users);
  res.json({ ok: true });
});

app.post('/api/users/:username/password', auth, (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (req.user.username !== username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only change your own password' });
  }
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: 'No such user' });
  user.salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.salt);
  writeJSON('users.json', users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  const before = users.length;
  users = users.filter(u => u.username !== username);
  if (users.length === before) return res.status(404).json({ error: 'No such user' });
  writeJSON('users.json', users);
  res.json({ ok: true });
});

// ---------- game records ----------
app.post('/api/games', auth, (req, res) => {
  const games = readJSON('games.json', []);
  const record = {
    id: crypto.randomUUID(),
    username: req.user.username,
    finishedAt: new Date().toISOString(),
    topic: req.body.topic,
    concept: req.body.concept,
    level: req.body.level,
    settings: req.body.settings,
    slides: req.body.slides,       // per-slide question, chosen answer, correct?
    correct: req.body.correct,
    total: req.body.total,
    durationSec: req.body.durationSec,
    recommendations: req.body.recommendations || null
  };
  games.push(record);
  writeJSON('games.json', games);
  res.json({ ok: true, id: record.id });
});

app.get('/api/games', auth, (req, res) => {
  const games = readJSON('games.json', []);
  res.json(req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username));
});

app.get('/api/games/export.csv', auth, (req, res) => {
  const games = readJSON('games.json', []);
  const mine = req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['user', 'date', 'topic', 'concept', 'level', 'correct', 'total', 'score_pct', 'duration_sec']];
  for (const g of mine) {
    rows.push([g.username, g.finishedAt, g.topic, g.concept, g.level, g.correct, g.total,
      g.total ? Math.round(100 * g.correct / g.total) : 0, g.durationSec]);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sketchlearn-progress.csv"');
  res.send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

// ---------- DeepSeek helpers ----------
async function deepseek(messages, { json = true, temperature = 0.8, maxTokens = 4096 } = {}) {
  if (!deepseekEnabled) throw new Error('DEEPSEEK_API_KEY is not configured. Set a real key in .env.');
  let lastParseErr = null;
  for (let attempt = 0; attempt < (json ? 4 : 1); attempt++) {
    const attemptMaxTokens = json ? Math.min(12288, Math.round(maxTokens * Math.pow(1.6, attempt))) : maxTokens;
    const body = {
      model: 'deepseek-chat',
      messages,
      temperature: attempt === 0 ? temperature : 0.2,
      max_tokens: attemptMaxTokens
    };
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from DeepSeek');
    if (!json) return content;
    try {
      return parseModelJson(content);
    } catch (e) {
      lastParseErr = e;
    }
  }
  throw lastParseErr || new Error('Model returned invalid JSON');
}

// Google Gemini text generation (OpenAI-style messages translated to Gemini's shape).
async function gemini(messages, { json = true, temperature = 0.8, maxTokens = 4096 } = {}) {
  if (!geminiEnabled) throw new Error('GEMINI_API_KEY is not configured. Set a real key in .env.');
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }]
  }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: String(messages[messages.length - 1]?.content || '') }] });
  let lastParseErr = null;
  for (let attempt = 0; attempt < (json ? 4 : 1); attempt++) {
    const attemptMaxTokens = json ? Math.min(12288, Math.round(maxTokens * Math.pow(1.6, attempt))) : maxTokens;
    const body = {
      contents,
      generationConfig: {
        temperature: attempt === 0 ? temperature : 0.2,
        maxOutputTokens: attemptMaxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) {
        throw new Error('Gemini API quota/rate limit hit (429). This is usually per-model or per-minute quota for this API key/project, not your overall billing balance.');
      }
      if (res.status === 503) {
        throw new Error('Gemini service is temporarily overloaded (503). Please retry in a moment.');
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts.map(p => p.text).filter(Boolean).join('');
    if (!content) throw new Error('Empty response from Gemini');
    if (!json) return content;
    try {
      return parseModelJson(content);
    } catch (e) {
      lastParseErr = e;
    }
  }
  throw lastParseErr || new Error('Model returned invalid JSON');
}

// Text-provider dispatcher with failover: Gemini first, then DeepSeek on quota/outage.
async function generateText(messages, opts) {
  if (geminiEnabled) {
    try {
      return await gemini(messages, opts);
    } catch (e) {
      const msg = String(e && e.message || '');
      const shouldFailover = /quota|rate limit|429|overloaded|503/i.test(msg);
      if (shouldFailover && deepseekEnabled) {
        console.warn('Gemini unavailable; falling back to DeepSeek for this request.');
        return deepseek(messages, opts);
      }
      throw e;
    }
  }
  return deepseek(messages, opts);
}

async function generateStructured(messages, opts = {}, { attempts = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await generateText(messages, {
        ...opts,
        json: true,
        temperature: i === 0 ? (opts.temperature ?? 0.8) : 0.2,
        maxTokens: Math.min(12288, Math.round((opts.maxTokens || 4096) * Math.pow(1.5, i)))
      });
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || '');
      // Retry only when the model output is malformed/truncated JSON.
      if (!/invalid JSON|Unterminated string|Unexpected end of JSON input|JSON/i.test(msg)) break;
    }
  }
  throw lastErr || new Error('Could not generate structured JSON');
}

// Strip anything executable from AI-generated SVG before it reaches the browser.
function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return '';
  let out = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
  const start = out.indexOf('<svg');
  const end = out.lastIndexOf('</svg>');
  if (start === -1 || end === -1) return '';
  return out.slice(start, end + 6);
}
function sanitizeComponents(components) {
  if (!Array.isArray(components)) return [];
  return components.map(c => {
    if (c && c.type === 'svg') c.svg = sanitizeSvg(c.svg);
    return c;
  }).filter(c => {
    if (!c || !c.type) return false;
    if (c.type === 'svg') return !!c.svg;
    if (c.type === 'code') return !!c.content;
    if (c.type === 'latex') return !!c.content;
    if (c.type === 'image') return !!(c.url || c.prompt);
    return true;
  });
}

// Generate one image. Prefers an OpenAI-compatible provider, else Gemini's image model.
async function generateImage(prompt) {
  if (IMAGE_API_KEY) {
    try {
      const res = await fetch(IMAGE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IMAGE_API_KEY}` },
        body: JSON.stringify({ model: IMAGE_API_MODEL, prompt, size: '1024x1024', n: 1 })
      });
      if (!res.ok) { console.error('Image API error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
      const data = await res.json();
      const item = data.data && data.data[0];
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item?.url) return item.url;
    } catch (e) { console.error('Image generation failed:', e.message); }
    return null;
  }
  if (geminiEnabled) return geminiImage(prompt);
  return null;
}

// Gemini native image generation (returns a base64 data URL).
async function geminiImage(prompt) {
  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });
    if (!res.ok) { console.error('Gemini image error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const img = parts.find(p => p.inlineData?.data || p.inline_data?.data);
    const inline = img && (img.inlineData || img.inline_data);
    if (inline?.data) return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
  } catch (e) { console.error('Gemini image generation failed:', e.message); }
  return null;
}

// Turn any {type:"image", prompt} components into real images; drop ones that fail.
async function fillImages(components) {
  for (const c of components) {
    if (c && c.type === 'image' && !c.url && c.prompt) {
      c.url = await generateImage(`${c.prompt}. Educational illustration in a hand-drawn sketch / paper-collage style, muted warm palette (paper cream, soft orange, green, blue), clear and uncluttered.`);
      delete c.prompt;
    }
  }
  return components.filter(c => !(c && c.type === 'image' && !c.url));
}

// Ask Claude (Anthropic Messages API) to DRAW one concept-accurate SVG for a slide.
// `brief` describes exactly what this slide teaches; `context` carries the concept,
// level and recent history so the drawing stays consistent with the lesson's progress.
async function generateSvgWithClaude(brief, context = {}) {
  if (!claudeSvgEnabled) return null;
  const historyLine = (context.history && context.history.length)
    ? `The lesson so far: ${context.history.map(h => h.title).filter(Boolean).join(' → ')}.`
    : 'This is the first slide of the lesson.';
  const prompt = `You are illustrating ONE slide of a "${context.topic}" lesson for a ${context.level} learner. The current concept is "${context.concept}". ${historyLine}

Draw a single self-contained SVG that ACCURATELY depicts what THIS slide teaches:
"""
${brief}
"""

Requirements:
- Return ONLY the <svg>...</svg> markup, nothing else — no prose, no code fences, no markdown.
- One <svg> with a viewBox around "0 0 400 260". No <script>, no external images, no <foreignObject>, no href to anything but "#".
- Hand-sketched style: stroke="#2d2a26" stroke-width="2.5" stroke-linecap="round", slightly irregular strokes. Fills ONLY from this palette: #f9a03f orange, #7fb069 green, #5c80bc blue, #e4572e red, #f7f3e9 paper, #fadf63 yellow.
- The drawing must genuinely illustrate the SPECIFIC idea (a real diagram/graph/labeled figure or clear visual metaphor), NOT a generic decorative shape. Label the important parts with <text> (font-size 14 or larger).
- Build on the earlier slides where it helps continuity, but this drawing must stand on its own for the current concept.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) { console.error('Anthropic SVG error', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
    const data = await res.json();
    const text = Array.isArray(data.content)
      ? data.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : '';
    const svg = sanitizeSvg(text);
    return svg || null;
  } catch (e) { console.error('Claude SVG generation failed:', e.message); return null; }
}

// Replace (or add) a slide's SVG with a Claude-drawn one, using the slide's own
// text as the drawing brief so the illustration matches the lesson exactly.
async function illustrateWithClaude(slide, context) {
  if (!claudeSvgEnabled) return;
  const brief = [
    slide.title,
    slide.summary,
    ...(slide.components || []).filter(c => c.type === 'text').map(c => c.content),
    ...(slide.components || []).filter(c => c.type === 'definition').map(c => `${c.term}: ${c.content}`)
  ].filter(Boolean).join(' ').slice(0, 1500);

  const svg = await generateSvgWithClaude(brief, context);
  if (!svg) return; // keep DeepSeek's own svg (if any) on failure
  const caption = slide.components?.find(c => c.type === 'svg')?.caption || '';
  // drop DeepSeek's svg components, then add Claude's illustration once
  slide.components = (slide.components || []).filter(c => c.type !== 'svg');
  slide.components.push({ type: 'svg', svg, caption, drawnBy: 'claude' });
}

// Persist every AI generation to a JSON file, as the site's content source of record.
function saveGeneration(kind, id, payload) {
  try {
    const dir = path.join(GEN_DIR, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(payload, null, 2));
  } catch (e) { console.error('Could not save generation:', e.message); }
}

const SKETCH_SVG_RULES = `SVG rules: self-contained <svg> with a viewBox (around 0 0 400 260), no external references, no scripts, no <text> smaller than 14px. Draw in a hand-sketched style: stroke-based shapes with stroke="#2d2a26" stroke-width="2.5" stroke-linecap="round", slightly irregular lines, fills only from this palette: #f9a03f (orange), #7fb069 (green), #5c80bc (blue), #e4572e (red), #f7f3e9 (paper), #fadf63 (yellow). CRITICAL: the drawing must accurately depict THIS slide's specific concept — a real diagram, labeled figure, graph, or visual metaphor of what the paragraphs explain. Label its parts with <text> so a viewer can map the picture onto the idea. A generic, decorative, or unrelated shape (a plain circle, a random zig-zag) is unacceptable; if the concept is a process show the steps, if it is a relationship show the axes/quantities, if it is a structure show and name the parts.`;

// ---------- AI: learning path ----------
app.post('/api/ai/path', auth, async (req, res) => {
  const { topic, guidance, levels, fromHistory, freshSeed } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const allLevels = ['Beginner', 'Lower Intermediate', 'Upper Intermediate', 'Advanced', 'PhD'];
  const wanted = Array.isArray(levels) && levels.length ? allLevels.filter(l => levels.includes(l)) : allLevels;

  // When refreshing from history, feed the learner's recent activity so the path adapts.
  let historyLine = '';
  if (fromHistory) {
    const games = readJSON('games.json', []).filter(g => g.username === req.user.username).slice(-15);
    if (games.length) {
      historyLine = '\nThe learner has recently studied (adapt the path to build on strengths and shore up weak spots, and suggest fresh concepts they have NOT yet seen):\n' +
        games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): scored ${g.correct}/${g.total}`).join('\n');
    } else {
      historyLine = '\nThe learner has no history yet — give a well-rounded introductory path.';
    }
  }

  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a curriculum designer. Given a study topic, produce a learning path as JSON with this exact schema:
{"topic": string, "overview": string (2 sentences max), "levels": [{"level": string, "description": string (1 sentence), "concepts": [{"name": string, "blurb": string (max 15 words)}]}]}
Include ONLY these levels, in this order: ${wanted.join(', ')}. Give 4-6 concrete, teachable concepts per level, ordered from first-to-learn to last. Respond with JSON only.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}` + (guidance ? `\nLearner guidance/request (adapt the path to this): ${guidance}` : '') + historyLine +
          (freshSeed ? `\n(Offer a genuinely fresh selection of concepts this time — vary them from a typical default. Variation token: ${freshSeed}.)` : '')
      }
    ], { temperature: fromHistory || freshSeed ? 0.95 : 0.7, maxTokens: 4096 });
    const id = crypto.randomUUID();
    saveGeneration('paths', id, { username: req.user.username, topic, guidance, result, createdAt: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: topic suggestions for the home chips ----------
app.post('/api/ai/topics', auth, async (req, res) => {
  const { count = 12, avoid = [] } = req.body || {};
  const wanted = Math.min(20, Math.max(6, parseInt(count, 10) || 12));
  const games = recentUserGames(req.user.username, 25);
  const learned = [...new Set(games.map(g => `${g.topic} / ${g.concept}`).filter(Boolean))].slice(-18);
  const avoidList = Array.isArray(avoid) ? avoid.map(String).filter(Boolean).slice(0, 30) : [];

  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `Return JSON only:
{"topics":[{"name":string,"why":string}]}
Rules:
- Exactly ${wanted} topics.
- Mix: about half deepen what this learner already studies; about half tie to current global issues/trends across fields.
- Topic names: short, concrete (2-5 words), classroom-safe.
- No duplicates.`
      },
      {
        role: 'user',
        content: `Learner recent studies:\n${learned.join('\n') || 'none yet'}\n\nAvoid these topic names:\n${avoidList.join('\n') || 'none'}`
      }
    ], { temperature: 0.7, maxTokens: 1800 });

    const topics = (result.topics || [])
      .map(t => ({
        name: String(t.name || '').trim(),
        why: String(t.why || '').trim()
      }))
      .filter(t => t.name)
      .filter((t, i, arr) => arr.findIndex(x => x.name.toLowerCase() === t.name.toLowerCase()) === i)
      .slice(0, wanted);

    res.json({ topics });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: refresh concepts for one level only ----------
app.post('/api/ai/path/level-refresh', auth, async (req, res) => {
  const { topic, level, count = 5, avoidConcepts = [], guidance } = req.body || {};
  if (!topic || !level) return res.status(400).json({ error: 'Topic and level are required' });
  const wanted = Math.min(8, Math.max(3, parseInt(count, 10) || 5));
  const games = recentUserGames(req.user.username, 20);
  const recent = games.map(g => `- ${g.topic} / ${g.concept} (${g.level}): ${g.correct}/${g.total}`).join('\n');
  const avoid = (Array.isArray(avoidConcepts) ? avoidConcepts : []).map(String).filter(Boolean).slice(0, 40);

  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a curriculum designer. Return JSON only:
{"level":string,"description":string,"concepts":[{"name":string,"blurb":string}]}
Rules:
- level must be exactly "${level}".
- exactly ${wanted} concepts.
- Keep concepts strictly at ${level} difficulty.
- concepts must be different from the avoid list.
- blurb max 15 words each.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n${guidance ? `Guidance: ${guidance}\n` : ''}Avoid concepts:\n${avoid.join('\n') || 'none'}\n\nRecent learner history:\n${recent || 'none yet'}\n\nBalance: reinforce this learner's weak spots while still surfacing globally relevant, timely angles.`
      }
    ], { temperature: 0.8, maxTokens: 2200 });

    const out = {
      level,
      description: String(result.description || '').trim(),
      concepts: (result.concepts || [])
        .map(c => ({ name: String(c.name || '').trim(), blurb: String(c.blurb || '').trim() }))
        .filter(c => c.name)
        .filter((c, i, arr) => arr.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase()) === i)
        .slice(0, wanted)
    };
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: one slide (also used to prefetch each answer branch) ----------
app.post('/api/ai/slide', auth, async (req, res) => {
  const { gameId, topic, concept, level, settings = {}, slideNumber, totalSlides, history = [], branch } = req.body || {};
  if (!topic || !concept || !slideNumber || !totalSlides) return res.status(400).json({ error: 'Missing slide context' });

  const paragraphWords = { brief: '40-60', medium: '70-100', detailed: '110-150' }[settings.paragraphLength] || '70-100';
  const paraCount = Math.min(7, Math.max(1, parseInt(settings.paragraphCount, 10) || 3));
  const densityRule = {
    'text-only': 'Use NO visual components (no svg/latex/code/image) — prose only.',
    'mostly-text': 'Mostly text: the paragraphs plus at most ONE visual component.',
    'balanced': 'Include the paragraphs plus ONE well-chosen visual that carries as much meaning as the words.',
    'mostly-visual': `Lead with 1-2 visual components that dominate the slide, but STILL include at least TWO connected paragraphs (each ${paragraphWords} words) explaining them.`
  }[settings.imageDensity] || 'Include one visual component alongside the paragraphs.';
  const allowModelSvg = !imageEnabled && !claudeSvgEnabled;
  const imageComponentLine = imageEnabled
    ? `\n   {"type":"image","prompt":string (vivid description of an illustration to GENERATE that depicts THIS slide's concept),"frame":"paper"|"polaroid","caption":string} |`
    : '';
  const visualMenu = imageEnabled
    ? 'a LaTeX formula, a code snippet, or a generated image'
    : (allowModelSvg
      ? 'a LaTeX formula, a code snippet, or a labelled svg diagram'
      : 'a LaTeX formula or a code snippet');
  const stemFocus = /math|physics|program|algorithm|computer|data|statistics|calculus|algebra|geometry|numerical|machine learning|ai|engineering|cryptography|proof|equation|formula|theorem|derivative|integral|linear algebra|probability/i
    .test(`${topic} ${concept}`);
  const equationDepth = {
    brief: 'Use 1 compact but meaningful derivation/proof block with 2-4 lines.',
    medium: 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.',
    detailed: 'Use a longer derivation/proof with 7-12 lines, explicitly showing key intermediate steps and assumptions.'
  }[settings.paragraphLength] || 'Use a moderately detailed derivation/proof with 4-7 lines and at least one intermediate step.';
  const codeDepth = {
    brief: 'Use a focused snippet around 8-15 lines.',
    medium: 'Use a practical snippet around 16-28 lines.',
    detailed: 'Use a richer snippet around 28-45 lines, still coherent and runnable.'
  }[settings.paragraphLength] || 'Use a practical snippet around 16-28 lines.';
  const stemAlternation = slideNumber % 2 === 1
    ? 'STEM alternation for this slide: emphasize theory + formulas/proof first, then support with a visual aid.'
    : 'STEM alternation for this slide: emphasize visual intuition first, then include code or formulas/proof with detailed explanation.';

  const system = `You are an expert teacher generating ONE slide of an adaptive learning presentation. Respond ONLY with JSON in this schema:
{
 "title": string (max 8 words),
 "summary": string (one sentence describing what this slide taught, for memory),
 "components": [
   {"type":"text","content":string (may contain inline LaTeX between single $ signs, e.g. $E=mc^2$)} |
   {"type":"keypoints","items":[string,...]} |
   {"type":"definition","term":string,"content":string} |
   {"type":"example","content":string} |
   {"type":"latex","content":string (a DISPLAY formula in LaTeX, WITHOUT surrounding $),"caption":string} |
   {"type":"code","language":string,"content":string (a real, correct, well-formatted snippet with newlines)} |
   ${allowModelSvg ? '{"type":"svg","svg":"<svg...>","caption":string} |\n   ' : ''}{"type":"image","prompt":string (vivid description of an illustration to GENERATE that depicts THIS slide's concept),"frame":"paper"|"polaroid","caption":string}${imageEnabled ? '' : ' (allowed only when IMAGE_API_KEY or GEMINI_API_KEY is configured)'}
 ],
 "quiz": {
   "question": string,
   "options": [
     {"text": string, "correct": boolean, "explanation": string (1-2 sentences shown when this option is picked), "misconception": string (for wrong options: what misunderstanding this choice reveals; empty for the correct one)}
   ]
 }
}
Rules:
- Exactly 4 quiz options, exactly ONE with "correct": true, shuffled position.
- Make the quiz genuinely CHALLENGING, not obvious: every option must be on-topic and plausible to someone who only half-understood the slide. Never make the correct answer the conspicuously longest or most detailed, and never make wrong options absurd or off-topic. Each wrong option is a common, tempting mistake that reveals a DIFFERENT misconception. A careless reader should be able to fall for a distractor; only careful reasoning from the slide's paragraphs should yield the right answer.
- LENGTH: the slide MUST contain exactly ${paraCount} distinct paragraph(s) of prose (as separate "text" components), each about ${paragraphWords} words. Do not collapse them, and do not pad — each paragraph carries new substance. ${densityRule}
- COHESION: the paragraphs must build on one another in order — introduce the idea, develop it, then apply or consolidate it — never restating the same point. The slide must also connect to the previous slides (briefly recall or build on them) and set up what comes next, so the whole presentation reads as one continuous, complementary lesson rather than isolated cards.
 - VISUALS: pick the visual that BEST fits this slide and make it ACCURATELY represent what the paragraphs say — never a generic or decorative figure (no meaningless Venn diagrams, plain squares, or random shapes). Choose from ${visualMenu}: use a LaTeX formula when the idea is mathematical, a code snippet (with the correct language) when it is about programming/algorithms/data, ${imageEnabled ? 'and a generated image when a rich pictorial or real-world depiction helps understanding. ' : ''}${allowModelSvg ? 'and a labelled svg diagram when the idea is a structure, process, or relationship. ' : ''}Vary the visual type across consecutive slides, and you may combine two (e.g. a formula AND an image). Prefer inline $...$ math inside paragraphs wherever a symbol or equation is mentioned.
- If a code snippet is included: ${codeDepth} Include clear inline comments that explain non-obvious lines and decisions.
- If a LaTeX formula/proof block is included: ${equationDepth} Follow it with explanatory text that walks through the symbols and logic step-by-step.
- Any formula/proof/code explanation should be as substantial as the selected paragraph length setting; avoid tiny token examples for long-form settings.
- ${stemFocus ? `${stemAlternation} For this STEM-heavy concept, include both: (1) a visual component (image/svg when available) and (2) either a code snippet or a LaTeX formula/proof block, plus textual explanation tying them together.` : 'Use STEM-style formula/code components only when they naturally fit the concept.'}
- Tone/sentiment of all writing: ${settings.tone || 'friendly lecture'}. Complexity of language: ${settings.complexity || 'standard'}. Audience level: ${level}.
${settings.language ? `- Write ALL text (including quiz and explanations) in ${settings.language}.\n` : ''}${settings.audience ? `- The reader is: ${settings.audience}. Pitch every explanation to them.\n` : ''}${settings.customInstructions ? `- Extra author instructions from the learner (follow them where they don't conflict with the schema): ${settings.customInstructions}\n` : ''}
- The ${paraCount} substantive paragraph(s) are required every time, alongside the chosen visual(s).
- ${allowModelSvg ? SKETCH_SVG_RULES : 'IMPORTANT: do NOT emit any "svg" components for this slide.'}${claudeSvgEnabled ? `\n- IMPORTANT: do NOT emit any "svg" components. A dedicated illustrator will draw the diagram for this slide separately. You may still use latex and code components; just leave the sketch/diagram to the illustrator.` : ''}`;

  const historyText = history.length
    ? 'Slides so far:\n' + history.map((h, i) =>
        `${i + 1}. "${h.title}" — ${h.summary} (quiz: "${h.question}" → learner chose "${h.chosen}", ${h.correct ? 'CORRECT' : 'WRONG'})`).join('\n')
    : 'This is the first slide.';

  let branchText = '';
  if (branch) {
    branchText = branch.correct
      ? `\nThe learner just answered the previous quiz CORRECTLY ("${branch.chosenText}"). This slide must go DEEPER into the concept: build on that success and drill further.`
      : `\nThe learner just answered the previous quiz WRONG ("${branch.chosenText}"), revealing this misconception: "${branch.misconception}". This slide must REDIRECT them: address that specific misconception head-on, re-explain the underlying idea from a different angle, then move forward.`;
  }

  const user = `Topic: ${topic}\nConcept being taught: ${concept}\nAudience level: ${level}\nThis is slide ${slideNumber} of ${totalSlides}.${slideNumber >= totalSlides ? ' This is the FINAL content slide: wrap up the concept and make the quiz a synthesis question.' : ''}\n${historyText}${branchText}`;

  try {
    const slide = await generateStructured([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.85, maxTokens: 8192 });
    slide.components = sanitizeComponents(slide.components);
    slide.components = await fillImages(slide.components); // generate any requested images (no-op without an image key)
    // Have Claude draw this slide's diagram, contextual to concept/level/progress
    // (unless the learner chose text-only). No-op without an Anthropic key.
    if (settings.imageDensity === 'text-only') {
      // enforce text-only regardless of what the model emitted
      slide.components = slide.components.filter(c => !['svg', 'image', 'latex', 'code'].includes(c.type));
    } else {
      await illustrateWithClaude(slide, { topic, concept, level, history });
    }
    if (!slide.quiz || !Array.isArray(slide.quiz.options) || !slide.quiz.options.some(o => o.correct)) {
      throw new Error('Model returned a slide without a valid quiz, please retry');
    }
    const genId = `${gameId || 'nogame'}-slide${slideNumber}${branch ? '-' + (branch.correct ? 'deeper' : 'remedial') + '-' + crypto.randomBytes(3).toString('hex') : ''}`;
    saveGeneration('slides', genId, { username: req.user.username, topic, concept, level, settings, slideNumber, branch: branch || null, slide, createdAt: new Date().toISOString() });
    res.json(slide);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: end-of-game recommendations ----------
app.post('/api/ai/recommend', auth, async (req, res) => {
  const { topic, concept, level, correct, total, durationSec, slides = [] } = req.body || {};
  try {
    const result = await generateStructured([
      {
        role: 'system',
        content: `You are a learning coach. Given a learner's quiz performance, respond ONLY with JSON:
{"summary": string (2 sentences, warm, specific), "recommendations": [string, string, string], "nextConcepts": [{"name": string, "level": string}]}
Recommendations must reference the actual mistakes made. nextConcepts: 2-3 concepts to study next.`
      },
      {
        role: 'user',
        content: `Topic: ${topic}, concept: ${concept}, level: ${level}. Score ${correct}/${total} in ${durationSec}s.\nAnswers:\n` +
          slides.map((s, i) => `${i + 1}. "${s.question}" → chose "${s.chosen}" (${s.correct ? 'correct' : `wrong — misconception: ${s.misconception || 'unknown'}`})`).join('\n')
      }
    ], { temperature: 0.7, maxTokens: 4096 });
    saveGeneration('recommendations', crypto.randomUUID(), { username: req.user.username, topic, concept, result, createdAt: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- AI: coach chat (sees the user's progress data) ----------
app.post('/api/ai/chat', auth, async (req, res) => {
  const { messages = [] } = req.body || {};
  const games = readJSON('games.json', []).filter(g => g.username === req.user.username);
  const progress = games.slice(-20).map(g => ({
    date: g.finishedAt, topic: g.topic, concept: g.concept, level: g.level,
    score: `${g.correct}/${g.total}`, durationSec: g.durationSec
  }));
  try {
    const reply = await generateText([
      {
        role: 'system',
        content: `You are the SketchLearn coach: a friendly guide inside an adaptive learning website. The site works like this: the learner picks a topic (or types a custom one), the AI builds a learning path across Beginner → Lower Intermediate → Upper Intermediate → Advanced → PhD levels, the learner picks a concept and tunes settings (number of slides, tone, text complexity, paragraph length, and how visual the slides are), then plays through AI-generated slides each ending in a comprehension quiz; wrong answers branch into remediation slides, right answers drill deeper; the final slide shows their stats.
Here is this learner's progress spreadsheet (their recent completed activities), as JSON:
${JSON.stringify(progress, null, 1)}
Use it to give concrete, personal guidance: point out strong/weak topics, suggest which concept and level to try next, and explain which settings to use. Keep replies short and warm (under 150 words unless asked for more). The learner is "${req.user.username}".`
      },
      ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
    ], { json: false, temperature: 0.8, maxTokens: 800 });
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SketchLearn running on http://localhost:${PORT}`);
  console.log(`Lesson text: ${geminiEnabled ? `Gemini (${GEMINI_TEXT_MODEL})${deepseekEnabled ? ' with DeepSeek failover' : ''}` : 'DeepSeek'}`);
  const illus = claudeSvgEnabled ? `Claude SVG (${ANTHROPIC_MODEL})`
    : (IMAGE_API_KEY ? `AI images (${IMAGE_API_MODEL})`
      : (geminiEnabled ? `AI images (${GEMINI_IMAGE_MODEL})` : "the text model's own SVG"));
  console.log(`Slide illustrations: ${illus}`);
  if (!geminiEnabled && !deepseekEnabled) console.warn('WARNING: no text provider set — set GEMINI_API_KEY or DEEPSEEK_API_KEY in .env. AI features will fail.');
});
