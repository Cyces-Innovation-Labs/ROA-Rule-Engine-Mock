// Netlify Function backing /api/rules (see netlify.toml redirect).
// Netlify equivalent of server.js's '/api/rules' entry in RESOURCES.
const { handleJsonArrayResource } = require('./_lib/jsonStore');
const seed = require('../../rules-data.json');

exports.handler = (event) =>
  handleJsonArrayResource(event, { storeName: 'rules', seed });
