/* Vercel serverless entry point.
 *
 * Vercel can't run a long-lived `node server.js` listener, so instead of calling
 * app.listen() we hand each incoming request straight to the same Express app.
 * `ready()` is the memoized one-time persistence bootstrap from server.js — we
 * await it before delegating so the DB/file storage is initialized on cold start.
 * If bootstrap fails (e.g. DB unreachable) it downgrades to file storage inside
 * server.js and we still serve the request rather than crashing the function. */
const { app, ready } = require('../server.js');

module.exports = async (req, res) => {
  try {
    await ready();
  } catch (e) {
    console.error('Bootstrap failed; serving in fallback mode:', e && e.message);
  }
  return app(req, res);
};
