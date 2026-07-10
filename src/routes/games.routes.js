/* Game-record routes + the shareable HTML report. */
const express = require('express');
const crypto = require('crypto');
const { buildBaseUrl, readGames, insertGame, deleteGameRecord } = require('../db/games');
const { auth, adminOnly } = require('../auth');

const router = express.Router();

// ---------- game records ----------
router.post('/api/games', auth, async (req, res) => {
  const shareId = String(req.body.shareId || crypto.randomUUID()).trim();
  const shareUrl = String(req.body.shareUrl || `${buildBaseUrl(req)}/report/${shareId}`).trim();
  const record = {
    id: crypto.randomUUID(),
    shareId,
    shareUrl,
    username: req.user.username,
    finishedAt: new Date().toISOString(),
    finishedDate: new Date().toLocaleDateString('en-US'),
    finishedTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    topic: req.body.topic,
    concept: req.body.concept,
    level: req.body.level,
    settings: req.body.settings,
    slides: req.body.slides,       // per-slide question, chosen answer, correct?
    correct: req.body.correct,
    total: req.body.total,
    durationSec: req.body.durationSec,
    recommendations: req.body.recommendations || null,
    questionSummary: req.body.questionSummary || null,
    answerSummary: req.body.answerSummary || null,
    aiNotes: req.body.aiNotes || null
  };
  await insertGame(record);
  res.json({ ok: true, id: record.id, shareId: record.shareId, shareUrl: record.shareUrl, finishedAt: record.finishedAt });
});

router.get('/api/games', auth, async (req, res) => {
  const games = await readGames();
  res.json(req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username));
});

router.get('/api/games/export.csv', auth, async (req, res) => {
  const games = await readGames();
  const mine = req.user.role === 'admin' ? games : games.filter(g => g.username === req.user.username);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['user', 'date', 'time', 'topic', 'concept', 'level', 'correct', 'total', 'score_pct', 'duration_sec', 'question_summary', 'answer_summary', 'ai_notes', 'share_url']];
  for (const g of mine) {
    rows.push([
      g.username,
      g.finishedDate || g.finishedAt,
      g.finishedTime || '',
      g.topic,
      g.concept,
      g.level,
      g.correct,
      g.total,
      g.total ? Math.round(100 * g.correct / g.total) : 0,
      g.durationSec,
      Array.isArray(g.questionSummary) ? g.questionSummary.join(' | ') : (g.questionSummary || ''),
      Array.isArray(g.answerSummary) ? g.answerSummary.join(' | ') : (g.answerSummary || ''),
      Array.isArray(g.aiNotes) ? g.aiNotes.join(' | ') : (g.aiNotes || ''),
      g.shareUrl || ''
    ]);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sketchlearn-progress.csv"');
  res.send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

router.delete('/api/games/:gameId', auth, adminOnly, async (req, res) => {
  const deleted = await deleteGameRecord(req.params.gameId);
  if (!deleted) return res.status(404).json({ error: 'No such game' });
  res.json({ ok: true });
});

router.get('/report/:shareId', async (req, res) => {
  const games = await readGames();
  const game = games.find(g => g.shareId === req.params.shareId || g.id === req.params.shareId);
  if (!game) return res.status(404).send('<h1>Report not found</h1>');

  const esc = v => String(v ?? '').replace(/[&<>\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const notes = Array.isArray(game.aiNotes) ? game.aiNotes : (game.aiNotes ? [game.aiNotes] : []);
  const recs = game.recommendations || {};
  const dateTime = `${esc(game.finishedDate || new Date(game.finishedAt).toLocaleDateString())} ${esc(game.finishedTime || new Date(game.finishedAt).toLocaleTimeString())}`;

  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SketchLearn Report</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f7f3e9;color:#2d2a26;margin:0;padding:24px;}
    .card{max-width:1100px;margin:0 auto;background:#fffdf6;border:2px solid #2d2a26;border-radius:24px;padding:20px;box-shadow:3px 4px 0 rgba(45,42,38,.25)}
    h1,h2{margin:0 0 12px} h1{font-size:30px} h2{font-size:22px;margin-top:18px}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:14px 0}
    .pill{border:1px solid #2d2a26;border-radius:999px;padding:8px 12px;background:#fff}
    .grid{display:grid;grid-template-columns:1.4fr .8fr;gap:18px} .box{background:#fff;border:1px solid #2d2a26;border-radius:18px;padding:14px}
    table{width:100%;border-collapse:collapse;background:#fff;overflow:auto} th,td{border:1px solid #2d2a26;padding:8px;vertical-align:top;text-align:left} th{background:#fadf63}
    .muted{opacity:.8} .notes li{margin-bottom:6px} a{color:#5c80bc} .list{margin:6px 0 0 20px}
    @media (max-width:900px){.grid{grid-template-columns:1fr}}
  </style></head><body><div class="card">
    <h1>SketchLearn Progress Report</h1>
    <div class="muted">Shared link created on ${dateTime}</div>
    <div class="meta">
      <div class="pill"><b>Student</b><br>${esc(game.username)}</div>
      <div class="pill"><b>Topic</b><br>${esc(game.topic)}</div>
      <div class="pill"><b>Concept</b><br>${esc(game.concept)}</div>
      <div class="pill"><b>Level</b><br>${esc(game.level)}</div>
      <div class="pill"><b>Score</b><br>${esc(game.correct)}/${esc(game.total)}</div>
      <div class="pill"><b>Time</b><br>${Math.floor((game.durationSec || 0) / 60)}:${String((game.durationSec || 0) % 60).padStart(2, '0')}</div>
    </div>
    <div class="grid">
      <div class="box">
        <h2>Summary</h2>
        <p><b>Coach summary:</b> ${esc(recs.summary || 'No coach summary saved.')}</p>
        <h2>Question Table</h2>
        <div style="overflow:auto"><table>
          <tr><th>#</th><th>Question</th><th>Answer</th><th>Result</th><th>Misconception / note</th></tr>
          ${(game.slides || []).map((s, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(s.question)}</td>
            <td>${esc(s.chosen)}</td>
            <td>${s.correct ? 'Correct' : 'Wrong'}</td>
            <td>${esc(s.misconception || '')}</td>
          </tr>`).join('') || '<tr><td colspan="5">No slide data.</td></tr>'}
        </table></div>
      </div>
      <div class="box">
        <h2>AI Notes</h2>
        <ul class="notes">${notes.length ? notes.map(n => `<li>${esc(n)}</li>`).join('') : '<li>No AI notes saved.</li>'}</ul>
        ${Array.isArray(recs.recommendations) && recs.recommendations.length ? `<h2>Recommendations</h2><ul class="notes">${recs.recommendations.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${Array.isArray(recs.nextConcepts) && recs.nextConcepts.length ? `<h2>Try next</h2><ul class="notes">${recs.nextConcepts.map(n => `<li>${esc(n.name)}${n.level ? ` (${esc(n.level)})` : ''}</li>`).join('')}</ul>` : ''}
        <p><b>Share URL</b><br><a href="${esc(game.shareUrl || '')}">${esc(game.shareUrl || '')}</a></p>
      </div>
    </div>
  </div></body></html>`);
});

module.exports = router;
