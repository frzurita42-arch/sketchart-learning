/* Cache-busted index.html serving + the SPA catch-all (must be mounted last). */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT_DIR } = require('../config');

const router = express.Router();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// Cache-busting: append a content-hash version to local asset URLs so a new deploy
// always loads fresh CSS/JS instead of a browser/CDN-cached copy. The version changes
// only when one of these files changes, so caching still works between deploys.
const VERSIONED_ASSETS = ['/css/sketch.css', '/js/app.js'];
const ASSET_VERSION = (() => {
  try {
    const h = crypto.createHash('sha1');
    for (const rel of VERSIONED_ASSETS) {
      try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, rel))); } catch { /* skip missing */ }
    }
    return h.digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
})();
function renderIndexHtml() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const rel of VERSIONED_ASSETS) {
    html = html.split(`"${rel}"`).join(`"${rel}?v=${ASSET_VERSION}"`);
  }
  return html;
}
let INDEX_HTML_CACHE = null;
function sendIndexHtml(res) {
  if (INDEX_HTML_CACHE === null) INDEX_HTML_CACHE = renderIndexHtml();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML_CACHE);
}

// SPA fallback — serves the cache-busted index so new deploys load fresh assets.
router.get(/^\/(?!api\/).*/, (req, res) => {
  sendIndexHtml(res);
});

module.exports = router;
