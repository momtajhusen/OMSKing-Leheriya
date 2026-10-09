const SkuMapping = require('../models/SkuMapping');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const InventoryReservation = require('../models/InventoryReservation');
const InventoryLedger = require('../models/InventoryLedger');
const { CHANNELS, channelById } = require('../channels/registry');
const { reserveStock, releaseReservation } = require('./inventory.service');

function channelIdOf(name) {
  const key = String(name || '').trim().toLowerCase();
  return channelById(key)?.id || CHANNELS.find((row) => row.name.toLowerCase() === key)?.id || '';
}

async function warehouseForLocation(tenantId, channel, locationId) {
  if (!locationId) return null;
  const map = await WarehouseLocationMap.findOne({
    tenantId,
    channel,
    externalLocationId: String(locationId),
  }).setOptions({ skipTenantFilter: true });
  if (!map?.warehouseId) return null;
  return Warehouse.findOne({ _id: map.warehouseId, tenantId }).setOptions({ skipTenantFilter: true });
}

async function prepareChannelItems(tenantId, channel, items = []) {
  const id = channelIdOf(channel);
  const next = [];
  for (const item of items) {
    const sku = String(item.sku || '').trim();
    const mapping = sku && id
      ? await SkuMapping.findOne({
        tenantId,
        channel: id,
        isActive: { $ne: false },
        channelSkuCode: sku,
        masterSkuId: { $ne: null },
      }).setOptions({ skipTenantFilter: true })
      : null;
    const warehouse = await warehouseForLocation(tenantId, id, item.locationId);
    const virtual = warehouse?.type === 'virtual';
    next.push({
      ...item,
      sku,
      masterSkuId: mapping?.masterSkuId || item.masterSkuId || null,
      skuMappingId: mapping?._id || item.skuMappingId || null,
      fulfilmentSource: virtual ? 'Virtual' : (item.fulfilmentSource || 'Offline'),
      warehouseId: warehouse?._id || null,
    });
  }
  return next;
}

async function releaseOrder(tenantId, orderNo) {
  try {
    await releaseReservation(tenantId, null, { orderRef: orderNo, reason: 'Channel order cancelled' });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

async function syncOrderReservations(tenantId, order) {
  if (!order?.orderNo) return { reserveState: '' };
  if (order.status === 'Cancelled') {
    await releaseOrder(tenantId, order.orderNo);
    order.reserveState = '';
    return { reserveState: '' };
  }
  if (!['New', 'Processing', 'Pending'].includes(order.status)) return { reserveState: order.reserveState || '' };
  const channel = channelIdOf(order.channel);
  let unmapped = false;
  let outOfStock = false;
  let reserved = false;
  for (let index = 0; index < (order.items || []).length; index += 1) {
    const item = order.items[index];
    if (!item.masterSkuId) {
      unmapped = true;
      continue;
    }
    if (!item.warehouseId && item.locationId) {
      const warehouse = await warehouseForLocation(tenantId, channel, item.locationId);
      item.warehouseId = warehouse?._id || null;
      if (warehouse?.type === 'virtual') item.fulfilmentSource = 'Virtual';
    }
    const qty = Math.max(1, Number(item.qty) || 1);
    const holds = await InventoryReservation.find({
      tenantId,
      orderRef: order.orderNo,
      masterSkuId: item.masterSkuId,
      status: 'held',
    }).setOptions({ skipTenantFilter: true });
    const heldQty = holds.reduce((sum, hold) => sum + hold.qty, 0);
    if (heldQty === qty) {
      reserved = true;
      continue;
    }
    for (const hold of holds) {
      await releaseReservation(tenantId, null, {
        idempotencyKey: hold.idempotencyKey,
        reason: 'Order quantity changed',
      });
    }
    try {
      await reserveStock(tenantId, null, {
        masterSkuId: item.masterSkuId,
        channel,
        qty,
        warehouseId: item.warehouseId || undefined,
        idempotencyKey: `${channel}:${order.externalOrderId || order.orderNo}:${item.sku}:${index}:q${qty}`,
        orderRef: order.orderNo,
        reason: `Reserve ${order.orderNo}`,
      });
      reserved = true;
    } catch (err) {
      if (err.statusCode === 409 || err.statusCode === 400) outOfStock = true;
      else throw err;
    }
  }
  if (unmapped && !reserved) order.reserveState = 'unmapped';
  else if (outOfStock) order.reserveState = 'out_of_stock';
  else if (reserved) order.reserveState = 'reserved';
  return { reserveState: order.reserveState };
}

async function restockRtoOnce(tenantId, order) {
  if (!order || order.rtoRestockedAt) return null;
  const items = (order.items || []).filter((item) => item.sku);
  order.rtoRestockedAt = new Date();
  if (!items.length) {
    await order.save();
    return null;
  }
  const { restockReturn } = require('./inventory.service');
  try {
    const result = await restockReturn(tenantId, null, {
      items,
      referenceId: order.orderNo,
      reason: `RTO ${order.orderNo}`,
      movementType: 'rto_restock',
      destination: 'All',
    });
    await order.save();
    return result;
  } catch (err) {
    if (!/No Master SKU/i.test(err.message || '')) throw err;
    await order.save();
    return null;
  }
}

async function reserveLedgerCount(tenantId, orderNo) {
  return InventoryLedger.countDocuments({
    tenantId,
    referenceId: orderNo,
    movementType: 'order_reserve',
  }).setOptions({ skipTenantFilter: true });
}

module.exports = {
  prepareChannelItems,
  syncOrderReservations,
  restockRtoOnce,
  reserveLedgerCount,
};
