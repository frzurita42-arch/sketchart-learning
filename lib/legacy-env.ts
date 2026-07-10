/* Environment defaults for the legacy `src/` modules.
 *
 * This module has NO imports on purpose: it must run to completion BEFORE any
 * code path reaches `src/config.js`. Every server module that touches the
 * legacy backend imports this file FIRST (as its first import), so these
 * defaults are applied before `config.js` evaluates.
 *
 * Why it matters: `src/config.js` calls `process.exit(1)` when
 * NODE_ENV=production and no AUTH_TOKEN_SECRET is set. `next build` runs with
 * NODE_ENV=production and evaluates route modules during page-data collection,
 * so without a default secret the build would abort. We supply a safe local
 * default (matching the legacy dev fallback) only when the operator has not set
 * one — a real deployment still sets AUTH_TOKEN_SECRET explicitly. */

if (!process.env.AUTH_TOKEN_SECRET || !process.env.AUTH_TOKEN_SECRET.trim()) {
  process.env.AUTH_TOKEN_SECRET = 'local-dev-session-secret';
}

export {};
