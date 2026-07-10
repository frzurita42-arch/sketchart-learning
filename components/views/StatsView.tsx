'use client';
/* My Stats view: the learner's history table + CSV export + password change.
 * Ported from public/js/views/stats.js. */
import { useEffect, useState } from 'react';
import { API } from '@/lib/api';
import { downloadCsv } from '@/lib/util';
import { Loading } from '@/components/ui/Loading';

function normalizeList(value: any, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((v: any) => String(v || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.split(/\s*[·,|]\s*/).map((v: string) => v.trim()).filter(Boolean);
}

function ListCell({ items, emptyText = '' }: { items: any; emptyText?: string | string[] }) {
  const list = normalizeList(items, Array.isArray(emptyText) ? emptyText : (emptyText ? [emptyText] : []));
  if (!list.length) return <>{Array.isArray(emptyText) ? '' : emptyText}</>;
  return <ul className="sheet-list">{list.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}

export function StatsView() {
  const [games, setGames] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    API.get('/api/games')
      .then((g: any) => { if (!cancelled) setGames(g); })
      .catch((e: any) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [reload]);

  if (error) return <div className="card">{error}</div>;
  if (games === null) return <Loading text="Fetching your sketchbook…" />;

  const mine = games.filter((g: any) => g.username === API.user?.username);
  const totalCorrect = mine.reduce((s: number, g: any) => s + (g.correct || 0), 0);
  const totalQ = mine.reduce((s: number, g: any) => s + (g.total || 0), 0);
  const totalTime = mine.reduce((s: number, g: any) => s + (g.durationSec || 0), 0);
  const isAdmin = API.user?.role === 'admin';
  const emptyColspan = isAdmin ? 11 : 10;

  const changePass = async () => {
    const p = prompt('New password:');
    if (!p) return;
    try { await API.post(`/api/users/${encodeURIComponent(API.user!.username)}/password`, { password: p }); alert('Password changed!'); }
    catch (e: any) { alert(e.message); }
  };

  const deleteGame = async (gameId: string) => {
    if (!gameId || !confirm('Delete this lesson record?')) return;
    try { await API.del(`/api/games/${encodeURIComponent(gameId)}`); setReload(n => n + 1); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <>
      <h1 className="view-title">My <span className="scribble-underline">stats</span></h1>
      <div className="stat-row">
        <div className="stat-tile"><div className="big">{mine.length}</div>activities</div>
        <div className="stat-tile"><div className="big">{totalQ ? Math.round(100 * totalCorrect / totalQ) : 0}%</div>avg score</div>
        <div className="stat-tile"><div className="big">{Math.round(totalTime / 60)}m</div>time learning</div>
      </div>
      <div className="stats-layout">
        <div className="stats-main card">
          <div className="table-wrap"><table className="sketch">
            <tbody>
              <tr>
                <th>Date</th><th>Time</th><th>Topic</th><th>Concept</th><th>Level</th><th>Score</th>
                <th>Question summary</th><th>Answer summary</th><th>AI notes</th><th>Share</th>{isAdmin && <th>Admin</th>}
              </tr>
              {mine.length ? mine.slice().reverse().map((g: any, idx: number) => {
                const shareHref = g.shareUrl || (g.shareId || g.id ? `/report/${encodeURIComponent(g.shareId || g.id)}` : '');
                return (
                  <tr className="stats-row" data-game-id={g.id || ''} key={g.id || idx}>
                    <td>{g.finishedDate || new Date(g.finishedAt).toLocaleDateString()}</td>
                    <td>{g.finishedTime || new Date(g.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{g.topic}</td><td>{g.concept}</td>
                    <td>{g.level}</td><td>{g.correct}/{g.total}</td>
                    <td className="summary-cell"><ListCell items={g.questionSummary} emptyText={(g.slides || []).map((s: any) => s.question).filter(Boolean).join(' · ')} /></td>
                    <td className="summary-cell"><ListCell items={g.answerSummary} emptyText={(g.slides || []).map((s: any) => s.chosen).filter(Boolean).join(' · ')} /></td>
                    <td className="summary-cell"><ListCell items={g.aiNotes} emptyText={g.recommendations?.summary ? [g.recommendations.summary] : ''} /></td>
                    <td>{shareHref ? <a href={shareHref} target="_blank" rel="noreferrer">open</a> : ''}</td>
                    {isAdmin && <td>{g.id ? <button className="btn small ghost delete-game" data-game-id={g.id} onClick={() => deleteGame(g.id)}>Delete</button> : ''}</td>}
                  </tr>
                );
              }) : <tr><td colSpan={emptyColspan}>Nothing yet — go learn something!</td></tr>}
            </tbody>
          </table></div>
          <div className="slide-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn small" id="export-csv" onClick={downloadCsv}>⬇ Download progress spreadsheet (CSV)</button>
            <button className="btn small ghost" id="change-pass" onClick={changePass}>Change my password</button>
          </div>
        </div>
      </div>
    </>
  );
}
