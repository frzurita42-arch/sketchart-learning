# ✏️ SketchLearn

An AI-powered adaptive learning website with a hand-drawn sketch theme. Pick any topic, get an
AI-generated learning path (Beginner → PhD), tune the activity settings, and play through
AI-generated slides where **every answer changes the next slide**: correct answers drill deeper,
wrong answers branch into remediation targeted at the exact misconception you revealed.

## Features

- **Topic picker** — preset subjects (Math, Physics, Chemistry, History, Biology…) plus free-form custom topics.
- **AI learning path** — 5 levels (Beginner, Lower Intermediate, Upper Intermediate, Advanced, PhD) with 4–6 concepts each. Redraw the path with custom guidance, filter which levels are shown, or type your own concept.
- **Activity settings** — number of slides (Short 4 / Medium 7 / Long 10 / custom 2–20), tone & sentiment (lecture, casual, hopeful, pessimistic, humorous, storytelling, Socratic, or custom), text complexity, paragraph length, and image density (text-only → mostly SVG sketches & graphs).
- **Adaptive slides** — each slide is built by the AI from a component library (text, key points, definition, example, hand-sketched SVG figure) and ends in a 4-option comprehension quiz. Wrong options each map to a *different misconception*; the next slide is generated from the one you actually picked.
- **Prefetching** — while you read, the next slide is generated in advance for *all four* answer options, so the branch you pick is already loaded when you click it.
- **Stats slide** — final slide shows name, time, correct answers, a per-question table, and AI recommendations for what to learn next.
- **JSON everywhere** — every AI generation is saved as a JSON file under `data/generated/`, and every finished activity is appended to `data/games.json` with the user, answers, score and time.
- **Coach chat** — a chat page where the AI reads your progress spreadsheet (downloadable as CSV) and guides your next steps on the site.
- **Sign-in + admin dashboard** — default admin `admin` / `123456` (changeable). Admin can add/delete users, set passwords, and see a table of all users and all game statistics.
- **Responsive** — works on phones, tablets, and desktops.

## Run it

```bash
cd sketchlearn
npm install
cp .env.example .env      # then set at least one text provider key
npm start                 # → http://localhost:3000
```

For production on Vercel, set `DATABASE_URL` (or `POSTGRES_URL`).
When present, the server stores users, game records, and home recommendation caches in Postgres.
Without it, the app falls back to local JSON files in `data/`.

## API keys by activity

Set these in Vercel for **Production, Preview, and Development** so every activity works the same everywhere:

- Required for all text-based activities (learning paths, Time Travel story slides, recommendations, coach chat):
   - `GEMINI_API_KEY` **or** `DEEPSEEK_API_KEY`
- Optional for generated slide images:
   - `IMAGE_API_KEY` (plus optional `IMAGE_API_URL`, `IMAGE_API_MODEL`)
- Optional for Claude-drawn SVG diagrams:
   - `ANTHROPIC_API_KEY` (plus optional `ANTHROPIC_MODEL`)

If no text provider key is configured, the app now serves built-in fallback content instead of hard-failing.

Sign in with `admin` / `123456`, then change the password from **My stats → Change my password**
(or from the dashboard) and add users from the **Dashboard**.

> ⚠️ Keep your DeepSeek key in `.env` only — it is git-ignored on purpose. Never commit API keys.

## How the adaptive engine works

1. The client asks `POST /api/ai/path` for a leveled curriculum for your topic.
2. Each slide comes from `POST /api/ai/slide` with the full compressed history of what you've
   seen and answered. The server prompt forces a strict JSON schema (components + quiz with
   per-option explanations and misconception tags) and sanitizes AI-generated SVG.
3. When a slide renders, the client immediately fires 4 prefetch requests — one per quiz option —
   each telling the AI "the learner chose X (correct/wrong because of misconception Y)". Only the
   branch that matches the learner's actual pick is shown.
4. On finish, `POST /api/ai/recommend` grades the run and `POST /api/games` records it to JSON.

## Data files (created at runtime, git-ignored)

If Postgres is configured, these become local fallback/dev artifacts.

| File | Contents |
| --- | --- |
| `data/users.json` | users with salted+hashed passwords |
| `data/games.json` | one record per finished activity (user, answers, score, time, recommendations) |
| `data/generated/paths/*.json` | every AI-generated learning path |
| `data/generated/slides/*.json` | every AI-generated slide, including unused prefetched branches |
| `data/generated/recommendations/*.json` | every end-of-game AI recommendation |
