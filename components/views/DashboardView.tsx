'use client';
/* Admin dashboard: user management + all-game statistics.
 * Ported from public/js/views/dashboard.js. */
import { useEffect, useState } from 'react';
import { API } from '@/lib/api';
import { downloadCsv } from '@/lib/util';
import { useApp } from '@/components/AppContext';
import { Loading } from '@/components/ui/Loading';

export function DashboardView() {
  const app = useApp();
  const [usersList, setUsersList] = useState<any[] | null>(null);
  const [games, setGames] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [userErr, setUserErr] = useState('');

  useEffect(() => {
    if (app.user?.role !== 'admin') { app.nav('home'); return; }
    let cancelled = false;
    Promise.all([API.get('/api/users'), API.get('/api/games')])
      .then(([u, g]: any[]) => { if (!cancelled) { setUsersList(u); setGames(g); } })
      .catch((e: any) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [reload, app]);

  if (error) return <div className="card">{error}</div>;
  if (usersList === null) return <Loading text="Opening the teacher’s desk…" />;

  const addUser = async () => {
    try {
      await API.post('/api/users', { username: newUser.trim(), password: newPass, role: newRole });
      setNewUser(''); setNewPass(''); setUserErr(''); setReload(n => n + 1);
    } catch (e: any) { setUserErr(e.message); }
  };
  const setPassword = async (username: string) => {
    const p = prompt(`New password for ${username}:`);
    if (!p) return;
    try { await API.post(`/api/users/${encodeURIComponent(username)}/password`, { password: p }); alert('Password updated.'); }
    catch (e: any) { alert(e.message); }
  };
  const delUser = async (username: string) => {
    if (!confirm(`Delete user ${username}? Their game history stays in the records.`)) return;
    try { await API.del(`/api/users/${encodeURIComponent(username)}`); setReload(n => n + 1); }
    catch (e: any) { alert(e.message); }
  };

  return (
    <>
      <h1 className="view-title">Teacher’s <span className="scribble-underline">dashboard</span></h1>
      <div className="card">
        <h3>👥 Users</h3>
        <div className="table-wrap"><table className="sketch">
          <tbody>
            <tr><th>Username</th><th>Role</th><th>Created</th><th>Games</th><th>Actions</th></tr>
            {usersList.map((u: any) => (
              <tr key={u.username}>
                <td>{u.username}</td><td>{u.role}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td><td>{u.gamesPlayed}</td>
                <td>
                  <button className="btn small" data-pass={u.username} onClick={() => setPassword(u.username)}>Set password</button>
                  {u.username !== app.user?.username && <button className="btn small ghost" data-del={u.username} onClick={() => delUser(u.username)}>✘ delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <h3 style={{ marginTop: 18 }}>➕ Add a user</h3>
        <div className="settings-grid" style={{ marginTop: 8 }}>
          <label className="field"><span>Username</span><input type="text" id="new-user" value={newUser} onChange={e => setNewUser(e.target.value)} /></label>
          <label className="field"><span>Password</span><input type="text" id="new-pass" value={newPass} onChange={e => setNewPass(e.target.value)} /></label>
          <label className="field"><span>Role</span>
            <select id="new-role" value={newRole} onChange={e => setNewRole(e.target.value)}>
              <option value="user">user</option><option value="admin">admin</option>
            </select></label>
        </div>
        <p className="form-error" id="user-err">{userErr}</p>
        <button className="btn green" id="add-user-btn" onClick={addUser}>Add user</button>
      </div>
      <div className="card alt">
        <h3>📊 All game statistics</h3>
        <div className="table-wrap"><table className="sketch">
          <tbody>
            <tr><th>User</th><th>Date</th><th>Topic</th><th>Concept</th><th>Level</th><th>Score</th><th>Time</th></tr>
            {games.length ? games.slice().reverse().map((g: any, i: number) => (
              <tr key={g.id || i}>
                <td>{g.username}</td><td>{new Date(g.finishedAt).toLocaleString()}</td>
                <td>{g.topic}</td><td>{g.concept}</td><td>{g.level}</td>
                <td>{g.correct}/{g.total}</td><td>{Math.floor(g.durationSec / 60)}:{String(g.durationSec % 60).padStart(2, '0')}</td>
              </tr>
            )) : <tr><td colSpan={7}>No games played yet.</td></tr>}
          </tbody>
        </table></div>
        <div className="slide-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn small" id="dash-export" onClick={downloadCsv}>⬇ Export all as CSV</button>
        </div>
      </div>
    </>
  );
}
