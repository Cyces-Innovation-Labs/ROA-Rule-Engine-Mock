// Netlify Function backing /api/agents (see netlify.toml redirect).
// Netlify equivalent of server.js's '/api/agents' entry in RESOURCES.
const { handleJsonArrayResource } = require('./_lib/jsonStore');
const seed = require('../../agents-data.json');

exports.handler = (event) =>
  handleJsonArrayResource(event, { storeName: 'agents', seed });
