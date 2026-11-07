/**
 * Loads one tenant's stock into OMSKing and holds stock for its open orders.
 *   node src/scripts/backfillStock.js <tenant-slug>            (dry run: counts only)
 *   node src/scripts/backfillStock.js <tenant-slug> --apply
 * --apply: reads on-hand from Shopify (no write to Shopify), gives every master SKU a stock row,
 * then reserves open orders. No channel stock push is queued by any step.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Tenant = require('../models/Tenant');
const { backfillStock } = require('../services/stockBackfill.service');

async function main() {
  const [slug, flag] = process.argv.slice(2);
  if (!slug) throw new Error('Usage: node src/scripts/backfillStock.js <tenant-slug> [--apply]');
  await mongoose.connect(config.mongodbUri);
  const tenant = await Tenant.findOne({ slug }).setOptions({ skipTenantFilter: true });
  if (!tenant) throw new Error(`Tenant ${slug} not found`);
  const result = await backfillStock(tenant._id, { dryRun: flag !== '--apply' });
  console.log(JSON.stringify({ tenant: tenant.name, apply: flag === '--apply', ...result }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
