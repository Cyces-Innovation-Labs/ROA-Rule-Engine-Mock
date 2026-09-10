// Netlify Function backing /api/transactions (see netlify.toml redirect).
// Netlify equivalent of server.js's '/api/transactions' entry in RESOURCES.
const { handleJsonArrayResource } = require('./_lib/jsonStore');
const seed = require('../../transactions-data.json');

exports.handler = (event) =>
  handleJsonArrayResource(event, { storeName: 'transactions', seed });
