/**
 * Removes demo / test rows from one tenant, keeping everything that came from a live channel.
 *   node src/scripts/clearDemoData.js <tenant-slug>          (dry run)
 *   node src/scripts/clearDemoData.js <tenant-slug> --apply
 * Live = SKUs that appear on channel orders (source channel_api / channel_push).
 * Kept: users, roles, warehouses, channel connections, couriers, API keys, settings.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');

const LIVE_SOURCES = ['channel_api', 'channel_push'];

async function main() {
  const [slug, flag] = process.argv.slice(2);
  if (!slug) throw new Error('Usage: node src/scripts/clearDemoData.js <tenant-slug> [--apply]');
  const apply = flag === '--apply';
  await mongoose.connect(config.mongodbUri);
  const db = mongoose.connection.db;
  const tenant = await db.collection('tenants').findOne({ slug });
  if (!tenant) throw new Error(`Tenant ${slug} not found`);
  const q = { tenantId: tenant._id };

  const liveOrders = await db.collection('orders').find({ ...q, source: { $in: LIVE_SOURCES } }).toArray();
  const liveSkus = new Set(liveOrders.flatMap((o) => (o.items || []).map((i) => String(i.sku).toUpperCase())));

  const mappings = await db.collection('sku_mappings').find(q).toArray();
  const liveMappings = mappings.filter((m) => liveSkus.has(String(m.channelSkuCode).toUpperCase()));
  const liveMasterIds = new Set(liveMappings.map((m) => String(m.masterSkuId)).filter((id) => id !== 'null'));
  const demoMappings = mappings.filter((m) => !liveMappings.includes(m));

  const masters = await db.collection('master_skus').find(q).toArray();
  const demoMasters = masters.filter((m) => !liveMasterIds.has(String(m._id)));
  const demoMasterIds = demoMasters.map((m) => m._id);
  const liveProductIds = new Set(masters.filter((m) => liveMasterIds.has(String(m._id))).map((m) => String(m.productId)));
  const products = await db.collection('products').find(q).toArray();
  const demoProducts = products.filter((p) => !liveProductIds.has(String(p._id)));

  const demoOrders = await db.collection('orders').find({ ...q, source: { $nin: LIVE_SOURCES } }).toArray();
  const shellJobs = await db.collection('integration_jobs').find({ ...q, shortSummary: /shell accepted/ }).toArray();
  const liveEventChannels = ['myntra'];
  const testEvents = await db.collection('webhook_events').find({ ...q, channel: { $nin: liveEventChannels } }).toArray();
  const testEventIds = testEvents.map((e) => e._id);

  const plan = {
    tenant: slug,
    liveOrders: liveOrders.length,
    liveSkus: liveSkus.size,
    delete: {
      orders: demoOrders.length,
      products: demoProducts.length,
      masterSkus: demoMasters.length,
      skuMappings: demoMappings.length,
      inventory: await db.collection('inventory').countDocuments({ ...q, masterSkuId: { $in: demoMasterIds } }),
      inventoryLedgers: await db.collection('inventory_ledgers').countDocuments({ ...q, masterSkuId: { $in: demoMasterIds } }),
      inventoryReservations: await db.collection('inventory_reservations').countDocuments({ ...q, masterSkuId: { $in: demoMasterIds } }),
      shellJobs: shellJobs.length,
      testWebhookEvents: testEvents.length,
    },
    sample: {
      masterSkus: demoMasters.slice(0, 10).map((m) => m.code),
      products: demoProducts.slice(0, 10).map((p) => p.name),
    },
  };
  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to delete.');
    await mongoose.disconnect();
    return;
  }

  await db.collection('orders').deleteMany({ _id: { $in: demoOrders.map((o) => o._id) } });
  await db.collection('inventory_reservations').deleteMany({ ...q, masterSkuId: { $in: demoMasterIds } });
  await db.collection('inventory_ledgers').deleteMany({ ...q, masterSkuId: { $in: demoMasterIds } });
  await db.collection('inventory').deleteMany({ ...q, masterSkuId: { $in: demoMasterIds } });
  await db.collection('sku_mappings').deleteMany({ _id: { $in: demoMappings.map((m) => m._id) } });
  await db.collection('master_skus').deleteMany({ _id: { $in: demoMasterIds } });
  await db.collection('products').deleteMany({ _id: { $in: demoProducts.map((p) => p._id) } });
  await db.collection('integration_jobs').deleteMany({
    $or: [{ _id: { $in: shellJobs.map((j) => j._id) } }, { webhookEventId: { $in: testEventIds } }],
  });
  await db.collection('webhook_events').deleteMany({ _id: { $in: testEventIds } });

  // Placeholder photos (picsum) were stamped on order lines before; real images come from the catalog.
  const picsum = /picsum\.photos/;
  const withPhotos = await db.collection('orders').find({ ...q, $or: [{ 'items.imageUrl': picsum }, { 'subOrders.imageUrl': picsum }] }).toArray();
  for (const order of withPhotos) {
    const strip = (rows) => (rows || []).map((row) => (picsum.test(row.imageUrl || '') ? { ...row, imageUrl: '' } : row));
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { items: strip(order.items), subOrders: strip(order.subOrders) } });
  }
  console.log(`Applied. Cleared placeholder photos on ${withPhotos.length} orders.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
