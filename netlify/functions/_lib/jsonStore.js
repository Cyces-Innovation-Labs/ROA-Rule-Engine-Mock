// Shared helper for the Netlify Functions that stand in for server.js's
// generic GET/PUT-JSON-array pattern (see RESOURCES in server.js) once
// this app runs on Netlify instead of `node server.js`.
//
// Netlify Functions have no persistent/writable filesystem (each
// invocation can run in a fresh, ephemeral container), so fs.readFileSync/
// writeFileSync — which server.js uses against attributes-data.json /
// rules-data.json on local disk — can't work here. Netlify Blobs is
// Netlify's own key-value store, reachable from Functions with zero extra
// config *when Netlify's automatic site-context injection works* — in
// practice this doesn't always kick in (hit this exact
// `MissingBlobsEnvironmentError` on a real deploy), so this falls back to
// explicit `siteID`/`token` config via env vars — see
// "Deployment (Netlify)" in CLAUDE.md for how to set BLOBS_SITE_ID /
// BLOBS_TOKEN.
//
// Kept as one shared helper (unlike attributes.js/rules.js on the
// frontend, which duplicate their versioning helpers on purpose — see
// CLAUDE.md) because this is infra plumbing, not domain logic — there's
// no independent-evolution reason to fork it per resource.

const { getStore } = require('@netlify/blobs');

const KEY = 'data';

function resolveStore(storeName) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  // Prefer explicit config when it's set — Netlify's automatic
  // site-context injection into getStore(name) doesn't always work
  // (varies by how/when the site was created); explicit siteID/token is
  // Netlify's own documented fallback for MissingBlobsEnvironmentError.
  return siteID && token ? getStore({ name: storeName, siteID, token }) : getStore(storeName);
}

// storeName: Blobs store name, one per resource ('attributes' | 'rules').
// seed: the bundled prototype JSON array (attributes-data.json /
//   rules-data.json), used to initialize the store on its very first GET
//   so a fresh deploy isn't an empty catalog.
async function handleJsonArrayResource(event, { storeName, seed }) {
  const store = resolveStore(storeName);

  if (event.httpMethod === 'GET') {
    let data = await store.get(KEY, { type: 'json' });
    if (data === null) {
      data = seed;
      await store.setJSON(KEY, data);
    }
    return jsonResponse(200, data);
  }

  if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
    let parsed;
    try {
      parsed = JSON.parse(event.body || '');
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.');
    } catch (e) {
      return jsonResponse(400, { ok: false, error: e.message });
    }
    await store.setJSON(KEY, parsed);
    return jsonResponse(200, { ok: true });
  }

  return {
    statusCode: 405,
    headers: { Allow: 'GET, PUT, POST' },
    body: 'Method not allowed',
  };
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

module.exports = { handleJsonArrayResource };
