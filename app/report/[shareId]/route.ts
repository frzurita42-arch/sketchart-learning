import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { readGames } from '@/src/db/games';
import { ensureReady } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  await ensureReady();
  const { shareId } = await params;
  const games = await readGames();
  const game = games.find((g: any) => g.shareId === shareId || g.id === shareId);
  if (!game) {
    return new NextResponse('<h1>Report not found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
  }

  const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (m: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[m]);
  const notes = Array.isArray(game.aiNotes) ? game.aiNotes : (game.aiNotes ? [game.aiNotes] : []);
  const recs = game.recommendations || {};
  const dateTime = `${esc(game.finishedDate || new Date(game.finishedAt).toLocaleDateString())} ${esc(game.finishedTime || new Date(game.finishedAt).toLocaleTimeString())}`;

  const html = `<!doctype html>
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
          ${(game.slides || []).map((s: any, i: number) => `<tr>
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
        <ul class="notes">${notes.length ? notes.map((n: any) => `<li>${esc(n)}</li>`).join('') : '<li>No AI notes saved.</li>'}</ul>
        ${Array.isArray(recs.recommendations) && recs.recommendations.length ? `<h2>Recommendations</h2><ul class="notes">${recs.recommendations.map((n: any) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${Array.isArray(recs.nextConcepts) && recs.nextConcepts.length ? `<h2>Try next</h2><ul class="notes">${recs.nextConcepts.map((n: any) => `<li>${esc(n.name)}${n.level ? ` (${esc(n.level)})` : ''}</li>`).join('')}</ul>` : ''}
        <p><b>Share URL</b><br><a href="${esc(game.shareUrl || '')}">${esc(game.shareUrl || '')}</a></p>
      </div>
    </div>
  </div></body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
