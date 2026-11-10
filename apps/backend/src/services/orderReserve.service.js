const SkuMapping = require('../models/SkuMapping');
const MasterSku = require('../models/MasterSku');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const InventoryReservation = require('../models/InventoryReservation');
const InventoryLedger = require('../models/InventoryLedger');
const { CHANNELS, channelById } = require('../channels/registry');
const { reserveStock, releaseReservation, consumeReservation } = require('./inventory.service');

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

async function masterFromShopifyLine(tenantId, sku, item) {
  const { ingestListing } = require('./catalogMapping.service');
  try {
    const out = await ingestListing(tenantId, null, {
      channel: 'shopify',
      channelSkuCode: sku,
      channelVariantId: item.channelVariantId || sku,
      channelProductId: item.channelProductId || '',
      title: item.name || sku,
      price: item.price,
      image: item.imageUrl || '',
    }, { createMaster: true });
    return out.mapping?.masterSkuId ? out.mapping : null;
  } catch (err) {
    console.error('[ORDER INGEST] master SKU not created for', sku, err.message);
    return null;
  }
}

async function prepareChannelItems(tenantId, channel, items = []) {
  const id = channelIdOf(channel);
  const next = [];
  for (const item of items) {
    const sku = String(item.sku || '').trim();
    let mapping = sku && id
      ? await SkuMapping.findOne({
        tenantId,
        channel: id,
        isActive: { $ne: false },
        channelSkuCode: sku,
        masterSkuId: { $ne: null },
      }).setOptions({ skipTenantFilter: true })
      : null;
    if (!mapping && sku && id === 'shopify') mapping = await masterFromShopifyLine(tenantId, sku, item);
    const warehouse = await warehouseForLocation(tenantId, id, item.locationId);
    const virtual = warehouse?.type === 'virtual';
    const master = mapping?.masterSkuId && (!Number(item.gst) || !item.hsn)
      ? await MasterSku.findOne({ _id: mapping.masterSkuId, tenantId }).select('hsnCode gstRatePercent').setOptions({ skipTenantFilter: true }).lean()
      : null;
    next.push({
      ...item,
      sku,
      hsn: item.hsn || master?.hsnCode || '',
      gst: Number(item.gst) || Number(master?.gstRatePercent) || 0,
      masterSkuId: mapping?.masterSkuId || item.masterSkuId || null,
      skuMappingId: mapping?._id || item.skuMappingId || null,
      fulfilmentSource: virtual ? 'Virtual' : (item.fulfilmentSource || 'Offline'),
      warehouseId: warehouse?._id || null,
    });
  }
  return next;
}

async function releaseOrder(tenantId, orderNo, reason = 'Channel order cancelled') {
  try {
    await releaseReservation(tenantId, null, { orderRef: orderNo, reason });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RESERVE_STATUS = ['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship'];
const STATUS_RANK = { New: 0, Pending: 0, Processing: 1, Packed: 2, 'Ready to Ship': 3, Dispatched: 4, Shipped: 4, 'In Transit': 4, 'Out for Delivery': 4, Delivered: 5 };

async function releaseKey(tenantId, idempotencyKey, reason) {
  try {
    await releaseReservation(tenantId, null, { idempotencyKey, reason });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

/**
 * Applies a channel status without moving the order backwards. A channel cancel only wins while the parcel
 * is still in the warehouse; after that the order keeps its status and the caller decides (RTO or not).
 */
function mergeChannelStatus(order, incoming) {
  const current = order.status;
  if (!incoming || incoming === current) return { cancelledAfterDispatch: false };
  if (current === 'Cancelled') {
    if (order.cancelSource !== 'oms' && incoming !== 'Cancelled') order.status = incoming;
    return { cancelledAfterDispatch: false };
  }
  const rank = (status) => STATUS_RANK[status] ?? -1;
  if (incoming === 'Cancelled') {
    const left = Boolean(order.pickedUpAt) || current === 'Delivered' || (rank(current) >= 4 && !order.labelGeneratedAt);
    if (left) return { cancelledAfterDispatch: true };
    order.status = 'Cancelled';
    order.cancelSource = 'channel';
    return { cancelledAfterDispatch: false };
  }
  if (rank(incoming) >= rank(current)) order.status = incoming;
  return { cancelledAfterDispatch: false };
}

async function consumeOrderStock(tenantId, orderNo) {
  if (!orderNo) return null;
  const held = await InventoryReservation.exists({ tenantId, orderRef: orderNo, status: 'held' }).setOptions({ skipTenantFilter: true });
  if (!held) return null;
  try {
    return await consumeReservation(tenantId, null, { orderRef: orderNo, reason: `Dispatched ${orderNo}` });
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Hold key prefix for one order line. A channel line id (Myntra orderLineId, or a seller order with one line)
 * keeps two lines with the same SKU apart when lines are cancelled or reordered; holds made before that
 * used the line position, so that prefix still counts as the same line.
 */
function lineKeys(order, orderPrefix, index) {
  const item = order.items[index];
  const lines = order.channelLines || [];
  const line = lines.length === order.items.length && lines[index]?.sku === item.sku ? lines[index] : null;
  let id = '';
  if (line?.orderLineId) id = `L${line.orderLineId}`;
  else if (line?.sellerOrderId && lines.filter((row) => row.sellerOrderId === line.sellerOrderId).length === 1) id = `S${line.sellerOrderId}`;
  const legacy = `${orderPrefix}${item.sku}:${index}:`;
  const prefix = id ? `${orderPrefix}${item.sku}:${id}:` : legacy;
  return { prefix, prefixes: [...new Set([prefix, legacy])], line };
}

function lineCancelled(order, line) {
  if (!line || !/myntra/i.test(order.channel || '')) return false;
  return require('./myntraSync.service').omsStatus(line.status) === 'Cancelled';
}

const keyRegex = (prefixes) => `^(?:${prefixes.map(escapeRegex).join('|')})`;

async function firstCount(tenantId, masterSkuId) {
  return InventoryLedger.findOne({ tenantId, masterSkuId, movementType: { $in: BASELINE_TYPES } })
    .sort({ recordedAt: 1 }).setOptions({ skipTenantFilter: true }).lean();
}

/**
 * A line first seen after it left the warehouse has no hold to consume. Its stock is taken off once, as a hold
 * consumed at once (so RTO can put it back), unless the order predates the SKU's first stock count.
 */
async function deductUnheldLines(tenantId, order, channel, orderPrefix, notify) {
  const placedAt = order.orderDate || order.createdAt || new Date();
  let added = false;
  for (let index = 0; index < (order.items || []).length; index += 1) {
    const item = order.items[index];
    if (!item.masterSkuId) continue;
    const { prefix, prefixes, line } = lineKeys(order, orderPrefix, index);
    if (lineCancelled(order, line)) continue;
    const holds = await InventoryReservation.find({
      tenantId,
      orderRef: order.orderNo,
      idempotencyKey: { $regex: keyRegex(prefixes) },
    }).setOptions({ skipTenantFilter: true }).lean();
    if (holds.some((hold) => hold.status !== 'released')) continue;
    const first = await firstCount(tenantId, item.masterSkuId);
    if (!first || placedAt < first.recordedAt) continue;
    const qty = Math.max(1, Number(item.qty) || 1);
    const baseKey = `${prefix}q${qty}`;
    try {
      await reserveStock(tenantId, null, {
        masterSkuId: item.masterSkuId,
        channel,
        qty,
        warehouseId: item.warehouseId || undefined,
        idempotencyKey: holds.some((hold) => hold.idempotencyKey === baseKey) ? `${baseKey}:v${holds.length}` : baseKey,
        orderRef: order.orderNo,
        reason: `Shipped ${order.orderNo} before OMSKing held it`,
        skipNotify: !notify,
      });
      added = true;
    } catch (err) {
      if (err.statusCode !== 409 && err.statusCode !== 400) throw err;
      console.error('[INVENTORY] shipped line not deducted for', order.orderNo, item.sku, err.message);
    }
  }
  if (added) await consumeOrderStock(tenantId, order.orderNo);
}

async function syncOrderReservations(tenantId, order, { notify = true } = {}) {
  if (!order?.orderNo) return { reserveState: '' };
  if (order.status === 'Cancelled') {
    await releaseOrder(tenantId, order.orderNo);
    order.reserveState = '';
    return { reserveState: '' };
  }
  const channel = channelIdOf(order.channel);
  const orderPrefix = `${channel}:${order.externalOrderId || order.orderNo}:`;
  if (!RESERVE_STATUS.includes(order.status)) {
    if (require('../models/Order').leftWarehouse(order)) await deductUnheldLines(tenantId, order, channel, orderPrefix, notify);
    return { reserveState: order.reserveState || '' };
  }
  const linePrefixes = [];
  let unmapped = false;
  let outOfStock = false;
  let reserved = false;
  for (let index = 0; index < (order.items || []).length; index += 1) {
    const item = order.items[index];
    const { prefix, prefixes, line } = lineKeys(order, orderPrefix, index);
    if (lineCancelled(order, line)) continue;
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
    linePrefixes.push(...prefixes);
    const lineHolds = await InventoryReservation.find({
      tenantId,
      orderRef: order.orderNo,
      idempotencyKey: { $regex: keyRegex(prefixes) },
    }).setOptions({ skipTenantFilter: true });
    const sameSku = (hold) => String(hold.masterSkuId) === String(item.masterSkuId);
    const shippedQty = lineHolds.filter((hold) => hold.status === 'consumed' && sameSku(hold)).reduce((sum, hold) => sum + hold.qty, 0);
    if (shippedQty >= qty) {
      reserved = true;
      continue;
    }
    const holds = lineHolds.filter((hold) => hold.status === 'held');
    const heldQty = holds.filter(sameSku).reduce((sum, hold) => sum + hold.qty, 0);
    if (heldQty === qty && holds.every(sameSku)) {
      reserved = true;
      continue;
    }
    for (const hold of holds) {
      await releaseKey(tenantId, hold.idempotencyKey, 'Order line changed');
    }
    const baseKey = `${prefix}q${qty}`;
    const idempotencyKey = lineHolds.some((hold) => hold.idempotencyKey === baseKey) ? `${baseKey}:v${lineHolds.length}` : baseKey;
    try {
      const held = await reserveStock(tenantId, null, {
        masterSkuId: item.masterSkuId,
        channel,
        qty,
        warehouseId: item.warehouseId || undefined,
        idempotencyKey,
        orderRef: order.orderNo,
        reason: `Reserve ${order.orderNo}`,
        skipNotify: !notify,
      });
      reserved = true;
      if (!held.idempotent && !lineHolds.length) {
        const { queueShopifyDecrement } = require('./inventoryPush.service');
        await queueShopifyDecrement(tenantId, { channel, masterSkuId: item.masterSkuId, qty, orderRef: order.orderNo })
          .catch((err) => console.error('[JOBS]', err.message));
      }
    } catch (err) {
      if (err.statusCode === 409 || err.statusCode === 400) outOfStock = true;
      else throw err;
    }
  }
  const stale = await InventoryReservation.find({
    tenantId,
    orderRef: order.orderNo,
    status: 'held',
    idempotencyKey: { $regex: `^${escapeRegex(orderPrefix)}` },
  }).setOptions({ skipTenantFilter: true }).lean();
  for (const hold of stale) {
    if (!linePrefixes.some((prefix) => hold.idempotencyKey.startsWith(prefix))) {
      await releaseKey(tenantId, hold.idempotencyKey, 'Line removed from the channel order');
    }
  }
  if (unmapped && !reserved) order.reserveState = 'unmapped';
  else if (outOfStock) order.reserveState = 'out_of_stock';
  else if (reserved) order.reserveState = 'reserved';
  return { reserveState: order.reserveState };
}

const RESTOCK_TYPES = ['return_restock', 'rto_restock'];
const BASELINE_TYPES = ['purchase_receipt', 'adjustment_plus', 'adjustment_minus', 'physical_count', 'virtual_sync', 'transfer_in', 'transfer_out'];
const LEFT_STATUS = /^(dispatched|shipped|in transit|out for delivery|delivered|rto|returned)/i;

function orderLeft(order) {
  return Boolean(order.pickedUpAt || order.awb || LEFT_STATUS.test(order.status || '') || /rto/i.test(order.channelStatus || ''));
}

/**
 * Units per master SKU that left the warehouse for this order and have not come back yet.
 * Left = a consumed hold, or (for a line that never had a hold) shipped before the SKU's first stock count.
 */
async function restockRoom(tenantId, order, extraRefs = []) {
  const { resolveMasterSkuForChannelSku } = require('./inventory.service');
  const CustomerReturn = require('../models/CustomerReturn');
  const room = new Map();
  const add = (key, qty) => room.set(key, (room.get(key) || 0) + qty);
  const holds = await InventoryReservation.find({ tenantId, orderRef: order.orderNo }).setOptions({ skipTenantFilter: true }).lean();
  holds.filter((hold) => hold.status === 'consumed').forEach((hold) => add(String(hold.masterSkuId), hold.qty));
  const heldSkus = new Set(holds.map((hold) => String(hold.masterSkuId)));
  if (orderLeft(order)) {
    const placedAt = order.orderDate || order.createdAt || new Date();
    for (const item of order.items || []) {
      const masterSkuId = item.masterSkuId || (await resolveMasterSkuForChannelSku(tenantId, item.sku))?._id;
      if (!masterSkuId || heldSkus.has(String(masterSkuId))) continue;
      const first = await firstCount(tenantId, masterSkuId);
      if (first && placedAt < first.recordedAt) add(String(masterSkuId), Math.max(1, Number(item.qty) || 1));
    }
  }
  const returnNos = await CustomerReturn.distinct('returnNo', { tenantId, orderNo: order.orderNo }).setOptions({ skipTenantFilter: true });
  const refs = [...new Set([order.orderNo, order.reversePickup?.returnId, ...returnNos, ...extraRefs].filter(Boolean))];
  const back = await InventoryLedger.find({ tenantId, movementType: { $in: RESTOCK_TYPES }, referenceId: { $in: refs } })
    .setOptions({ skipTenantFilter: true }).lean();
  back.forEach((row) => add(String(row.masterSkuId), -Math.abs(row.qtyDelta)));
  return room;
}

/** Caps each item at the room left for its master SKU. Items whose SKU maps to nothing are listed in unmapped. */
async function capToRoom(tenantId, items, room) {
  const { resolveMasterSkuForChannelSku } = require('./inventory.service');
  const capped = [];
  const unmapped = [];
  for (const item of items || []) {
    const plain = item?.toObject ? item.toObject() : { ...item };
    const masterSkuId = plain.masterSkuId || (await resolveMasterSkuForChannelSku(tenantId, plain.sku))?._id;
    if (!masterSkuId) {
      unmapped.push(plain.sku || plain.name || 'an item');
      continue;
    }
    const key = String(masterSkuId);
    const qty = Math.min(Math.max(1, Number(plain.qty) || 1), room.get(key) || 0);
    if (qty <= 0) continue;
    room.set(key, room.get(key) - qty);
    capped.push({ ...plain, masterSkuId, qty });
  }
  return { items: capped, unmapped };
}

async function restockRtoOnce(tenantId, order, { destination = 'All', userId = null } = {}) {
  if (!order || order.rtoRestockedAt) return null;
  const Order = require('../models/Order');
  const at = new Date();
  const claim = await Order.updateOne({ _id: order._id, tenantId, rtoRestockedAt: null }, { $set: { rtoRestockedAt: at } })
    .setOptions({ skipTenantFilter: true });
  if (!claim.modifiedCount) return null;
  order.rtoRestockedAt = at;
  try {
    const held = await InventoryReservation.exists({ tenantId, orderRef: order.orderNo, status: 'held' }).setOptions({ skipTenantFilter: true });
    if (held) await releaseOrder(tenantId, order.orderNo, `RTO ${order.orderNo} before dispatch`);
    const { items } = await capToRoom(tenantId, order.items, await restockRoom(tenantId, order));
    const { restockReturn } = require('./inventory.service');
    const result = items.length
      ? await restockReturn(tenantId, userId, { items, referenceId: order.orderNo, reason: `RTO ${order.orderNo}`, movementType: 'rto_restock', destination })
      : null;
    await order.save();
    return result;
  } catch (err) {
    await Order.updateOne({ _id: order._id, tenantId, rtoRestockedAt: at }, { $set: { rtoRestockedAt: null } }).setOptions({ skipTenantFilter: true });
    order.rtoRestockedAt = null;
    throw err;
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
  consumeOrderStock,
  restockRtoOnce,
  mergeChannelStatus,
  restockRoom,
  capToRoom,
  reserveLedgerCount,
  BASELINE_TYPES,
};
