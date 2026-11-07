const MasterSku = require('../models/MasterSku');
const Warehouse = require('../models/Warehouse');
const Inventory = require('../models/Inventory');
const Order = require('../models/Order');
const { syncOrderReservations } = require('./orderReserve.service');

const OPEN = ['New', 'Processing', 'Pending'];
const BATCH = 1000;

const skip = (query) => query.setOptions({ skipTenantFilter: true });

async function mainWarehouse(tenantId) {
  return await skip(Warehouse.findOne({ tenantId, type: 'physical', status: 'active', isDefault: true }))
    || skip(Warehouse.findOne({ tenantId, type: 'physical', status: 'active' }).sort({ code: 1 }));
}

// Zero rows carry no ledger entry, so channel pushes skip them until real stock is recorded.
async function ensureStockRows(tenantId, { dryRun = false } = {}) {
  const warehouse = await mainWarehouse(tenantId);
  if (!warehouse) return { warehouse: '', missing: 0, created: 0 };
  const withRows = new Set((await skip(Inventory.distinct('masterSkuId', { tenantId }))).map(String));
  const ids = (await skip(MasterSku.find({ tenantId }).select('_id')).lean()).map((row) => row._id).filter((id) => !withRows.has(String(id)));
  if (dryRun) return { warehouse: warehouse.code, missing: ids.length, created: 0 };
  let created = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const ops = ids.slice(i, i + BATCH).map((masterSkuId) => ({
      updateOne: {
        filter: { tenantId, masterSkuId, warehouseId: warehouse._id },
        update: { $setOnInsert: { tenantId, masterSkuId, warehouseId: warehouse._id } },
        upsert: true,
      },
    }));
    const res = await Inventory.bulkWrite(ops, { ordered: false });
    created += res.upsertedCount || 0;
  }
  return { warehouse: warehouse.code, missing: ids.length, created };
}

async function reserveOpenOrders(tenantId, { dryRun = false } = {}) {
  const orders = await skip(Order.find({ tenantId, status: { $in: OPEN } }));
  const out = { open: orders.length, reserved: 0, out_of_stock: 0, unmapped: 0, failed: 0 };
  if (dryRun) return out;
  for (const order of orders) {
    try {
      const { reserveState } = await syncOrderReservations(tenantId, order, { notify: false });
      await order.save();
      if (out[reserveState] != null) out[reserveState] += 1;
    } catch (err) {
      out.failed += 1;
      console.error('[BACKFILL] reserve failed for', order.orderNo, err.message);
    }
  }
  return out;
}

async function backfillStock(tenantId, { dryRun = false, importShopify = true, deps = {} } = {}) {
  const result = {};
  if (importShopify && !dryRun) {
    const { importShopifyOpeningStock } = require('./shopifyOpeningStock.service');
    result.shopifyOpening = await importShopifyOpeningStock(tenantId, null, deps);
  }
  result.stockRows = await ensureStockRows(tenantId, { dryRun });
  result.openOrders = await reserveOpenOrders(tenantId, { dryRun });
  return result;
}

module.exports = { ensureStockRows, reserveOpenOrders, backfillStock };
