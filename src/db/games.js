/* Game (finished-run) records across file or Postgres storage. */
const { db, dbQuery, withDbTimeout } = require('./pool');
const { readJSON, writeJSON } = require('./persistence');

function buildBaseUrl(req) {
  const host = req.get('host');
  return `${req.protocol}://${host}`;
}

async function readGames() {
  if (!db.pool) return readJSON('games.json', []);
  let dbGames = [];
  try {
    const { rows } = await withDbTimeout(dbQuery('SELECT * FROM games ORDER BY finished_at ASC'), 8000, 'Read games');
    dbGames = rows.map(r => ({
      id: r.id,
      shareId: r.share_id,
      shareUrl: r.share_url,
      username: r.username,
      finishedAt: new Date(r.finished_at).toISOString(),
      finishedDate: r.finished_date,
      finishedTime: r.finished_time,
      topic: r.topic,
      concept: r.concept,
      level: r.level,
      settings: r.settings,
      slides: r.slides,
      correct: r.correct,
      total: r.total,
      durationSec: r.duration_sec,
      recommendations: r.recommendations,
      questionSummary: r.question_summary,
      answerSummary: r.answer_summary,
      aiNotes: r.ai_notes
    }));
  } catch (e) {
    console.error('DB read for games failed; falling back to file records:', e.message);
  }
  // Merge any records saved to the file fallback (e.g. when a DB write timed out),
  // so a finished game is never missing from My Stats just because the DB was slow.
  const fileGames = readJSON('games.json', []);
  if (!Array.isArray(fileGames) || !fileGames.length) return dbGames;
  const seen = new Set(dbGames.map(g => g.id));
  const merged = dbGames.concat(fileGames.filter(g => g && g.id && !seen.has(g.id)));
  merged.sort((a, b) => new Date(a.finishedAt || 0) - new Date(b.finishedAt || 0));
  return merged;
}

function insertGameFile(record) {
  const games = readJSON('games.json', []);
  games.push(record);
  writeJSON('games.json', games);
}

async function insertGame(record) {
  if (!db.pool) {
    insertGameFile(record);
    return;
  }
  try {
    await withDbTimeout(dbQuery(
      `INSERT INTO games (
        id, share_id, share_url, username, finished_at, finished_date, finished_time,
        topic, concept, level, settings, slides, correct, total, duration_sec,
        recommendations, question_summary, answer_summary, ai_notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19
      )`,
      [
        record.id,
        record.shareId,
        record.shareUrl,
        record.username,
        record.finishedAt,
        record.finishedDate,
        record.finishedTime,
        record.topic,
        record.concept,
        record.level,
        record.settings || null,
        record.slides || null,
        record.correct,
        record.total,
        record.durationSec,
        record.recommendations || null,
        record.questionSummary || null,
        record.answerSummary || null,
        record.aiNotes || null
      ]
    ), 8000, 'Save game');
  } catch (e) {
    // DB slow/unreachable: don't lose the run — persist to file as a backup and succeed.
    console.error('DB insert failed; saving run to file storage instead:', e.message);
    insertGameFile(record);
  }
}

async function deleteGameRecord(gameId) {
  if (!db.pool) {
    const games = readJSON('games.json', []);
    const before = games.length;
    const next = games.filter(g => g.id !== gameId && g.shareId !== gameId);
    if (next.length === before) return false;
    writeJSON('games.json', next);
    return true;
  }
  const { rowCount } = await dbQuery('DELETE FROM games WHERE id = $1 OR share_id = $1', [gameId]);
  return rowCount > 0;
}

async function recentUserGames(username, limit = 20) {
  if (!db.pool) {
    return readJSON('games.json', [])
      .filter(g => g.username === username)
      .slice(-limit);
  }
  const { rows } = await dbQuery(
    'SELECT * FROM games WHERE username = $1 ORDER BY finished_at DESC LIMIT $2',
    [username, Math.max(1, parseInt(limit, 10) || 20)]
  );
  return rows.reverse().map(r => ({
    id: r.id,
    shareId: r.share_id,
    shareUrl: r.share_url,
    username: r.username,
    finishedAt: new Date(r.finished_at).toISOString(),
    finishedDate: r.finished_date,
    finishedTime: r.finished_time,
    topic: r.topic,
    concept: r.concept,
    level: r.level,
    settings: r.settings,
    slides: r.slides,
    correct: r.correct,
    total: r.total,
    durationSec: r.duration_sec,
    recommendations: r.recommendations,
    questionSummary: r.question_summary,
    answerSummary: r.answer_summary,
    aiNotes: r.ai_notes
  }));
}

module.exports = { buildBaseUrl, readGames, insertGameFile, insertGame, deleteGameRecord, recentUserGames };
