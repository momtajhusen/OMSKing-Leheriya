const shopify = require('./shopify');
const amazon = require('./amazon');
const myntra = require('./myntra');

const adapters = { shopify, amazon, myntra };

function adapterFor(channel) {
  return adapters[String(channel || '').toLowerCase()] || null;
}

module.exports = { adapterFor, adapters };
