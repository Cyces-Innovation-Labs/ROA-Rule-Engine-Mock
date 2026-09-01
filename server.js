// ROA Rule Engine — minimal local dev server.
//
// Serves the static app files and persists the Attribute and Rule
// catalogs to JSON files on disk (attributes-data.json, rules-data.json)
// instead of browser localStorage, so they're shared across browsers/
// machines via the project folder. This reverses the project's earlier
// "no backend" decision — see CLAUDE.md for why and what changed.
//
// Zero dependencies: only Node's built-in http/fs/path modules. No
// npm install needed, no framework — run with `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5050;
const ROOT = __dirname;

// Each entry is a GET/PUT JSON-array resource, backed by one file. Adding
// Rules alongside Attributes here is a deliberate, second instance of the
// same pattern — not a general API layer (see CLAUDE.md's original
// "nothing else should be added without a similar deliberate decision").
const RESOURCES = {
  '/api/attributes': path.join(ROOT, 'attributes-data.json'),
  '/api/rules': path.join(ROOT, 'rules-data.json'),
};

// Path-based routing: the app has two client-side "pages" (Attributes,
// Rules), navigated via the History API (no router library — see
// index.html's App component). The browser can request either path
// directly (typed URL, refresh, bookmark), so the server must answer both
// with index.html rather than 404ing — this is the standard SPA-fallback
// pattern, kept to an explicit, small list rather than a catch-all, so a
// genuinely missing asset still 404s normally.
const APP_ROUTES = ['/', '/attributes', '/rules'];

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonArray(dataFile) {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return []; // missing file or invalid JSON — start from an empty catalog
  }
}

function handleApiRequest(req, res, dataFile) {
  if (req.method === 'GET') {
    sendJson(res, 200, readJsonArray(dataFile));
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.');
        fs.writeFileSync(dataFile, JSON.stringify(parsed, null, 2));
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
    });
    return;
  }

  res.writeHead(405, { Allow: 'GET, PUT, POST' });
  res.end('Method not allowed');
}

function serveStatic(req, res) {
  const routePath = req.url.split('?')[0];
  const urlPath = APP_ROUTES.includes(routePath) ? '/index.html' : routePath;
  const filePath = path.join(ROOT, decodeURIComponent(urlPath));

  // Prevent path traversal outside the project root.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const routePath = req.url.split('?')[0];
  const dataFile = RESOURCES[routePath];
  if (dataFile) {
    handleApiRequest(req, res, dataFile);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`ROA Rule Engine running at http://localhost:${PORT}`);
  for (const [route, file] of Object.entries(RESOURCES)) {
    console.log(`  ${route} -> ${file}`);
  }
});
