// Netlify Function backing /api/attributes (see netlify.toml redirect).
// Netlify equivalent of server.js's '/api/attributes' entry in RESOURCES.
const { handleJsonArrayResource } = require('./_lib/jsonStore');
const seed = require('../../attributes-data.json');

exports.handler = (event) =>
  handleJsonArrayResource(event, { storeName: 'attributes', seed });
