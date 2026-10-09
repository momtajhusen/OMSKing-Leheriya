const shopify = require('./shopify');
const amazon = require('./amazon');
const myntra = require('./myntra');
const partner = require('./partner');
const { channelById, channelIds } = require('../channels/registry');

const adapters = { shopify, amazon, myntra };
channelIds().forEach((id) => {
  if (channelById(id)?.kind === 'partner') adapters[id] = partner;
});

function adapterFor(channel) {
  return adapters[String(channel || '').toLowerCase()] || null;
}

module.exports = { adapterFor, adapters };
