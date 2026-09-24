const crypto = require('crypto');
const Inventory = require('../models/Inventory');
const InventoryLedger = require('../models/InventoryLedger');
const InventoryReservation = require('../models/InventoryReservation');
const Warehouse = require('../models/Warehouse');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');
const {
  ensureDefaultWarehouses,
  warehousesForChannel,
  getInventoryAuthority,
  newTransactionId,
  channelsOf,
} = require('./warehouse.service');

function availableOf(row) {
  return (row.physicalQty || 0) + (row.virtualQty || 0) - (row.reservedQty || 0);
}

function onHandOf(row) {
  return (row.physicalQty || 0) + (row.virtualQty || 0);
}

function qtyField(warehouse) {
  return warehouse.type === 'virtual' ? 'virtualQty' : 'physicalQty';
}

function assertQty(qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Quantity must be a positive integer');
  return n;
}

async function requireSku(tenantId, masterSkuId) {
  const sku = await MasterSku.findOne({ _id: masterSkuId, tenantId }).setOptions({ skipTenantFilter: true });
  if (!sku) throw new HttpError(404, 'Master SKU not found');
  return sku;
}

async function requireWarehouse(tenantId, warehouseId) {
  const row = await Warehouse.findOne({ _id: warehouseId, tenantId, status: 'active' }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Warehouse not found');
  return row;
}

async function assertOmsMaster(tenantId) {
  const authority = await getInventoryAuthority(tenantId);
  if (authority === 'shopify') {
    throw new HttpError(403, 'Shopify is inventory master. Sellable qty cannot be edited in OMS.');
  }
}

const availableExpr = {
  $subtract: [
    { $add: [{ $ifNull: ['$physicalQty', 0] }, { $ifNull: ['$virtualQty', 0] }] },
    { $ifNull: ['$reservedQty', 0] },
  ],
};

async function getOrCreateBalance(tenantId, masterSkuId, warehouseId) {
  const existing = await Inventory.findOne({ tenantId, masterSkuId, warehouseId }).setOptions({ skipTenantFilter: true });
  if (existing) return existing;
  try {
    return await Inventory.create({
      tenantId,
      masterSkuId,
      warehouseId,
      physicalQty: 0,
      virtualQty: 0,
      reservedQty: 0,
      reorderPoint: 10,
    });
  } catch (err) {
    if (err.code === 11000) {
      return Inventory.findOne({ tenantId, masterSkuId, warehouseId }).setOptions({ skipTenantFilter: true });
    }
    throw err;
  }
}

async function appendLedger({
  tenantId, masterSkuId, warehouseId, movementType, qtyDelta, balance, channel, referenceType, referenceId, reason, userId, transactionId,
}) {
  return InventoryLedger.create({
    tenantId,
    masterSkuId,
    warehouseId,
    transactionId: transactionId || newTransactionId(),
    movementType,
    qtyDelta,
    balanceAfter: onHandOf(balance),
    reservedAfter: balance.reservedQty,
    availableAfter: availableOf(balance),
    channel: channel || '',
    referenceType: referenceType || '',
    referenceId: referenceId || '',
    reason: reason || '',
    performedBy: userId || null,
    recordedAt: new Date(),
  });
}

function mapBalance(row, warehouse, sku) {
  const available = availableOf(row);
  const onHand = onHandOf(row);
  const reorderPoint = row.reorderPoint ?? 10;
  return {
    id: String(row._id),
    masterSkuId: String(row.masterSkuId._id || row.masterSkuId),
    sku: sku?.code || row.masterSkuId?.code || '',
    productName: sku?.name || row.masterSkuId?.name || '',
    cost: sku?.costPrice || row.masterSkuId?.costPrice || 0,
    warehouseId: String(row.warehouseId._id || row.warehouseId),
    warehouse: warehouse?.code || row.warehouseId?.code || '',
    warehouseType: warehouse?.type || row.warehouseId?.type || '',
    channels: warehouse ? channelsOf(warehouse) : [],
    physicalQty: row.physicalQty,
    virtualQty: row.virtualQty,
    stock: onHand,
    reserved: row.reservedQty,
    available,
    reorderPoint,
    safetyStock: row.safetyStock || 0,
    low: available <= reorderPoint,
  };
}

async function listBalances(tenantId, { warehouseId, q, tab } = {}) {
  await ensureDefaultWarehouses(tenantId);
  const filter = { tenantId };
  if (warehouseId) filter.warehouseId = warehouseId;
  const rows = await Inventory.find(filter)
    .populate('masterSkuId')
    .populate('warehouseId')
    .sort({ updatedAt: -1 })
    .setOptions({ skipTenantFilter: true });
  let data = rows.map((row) => mapBalance(row, row.warehouseId, row.masterSkuId));
  if (q) {
    const needle = String(q).toLowerCase();
    data = data.filter((row) => row.sku.toLowerCase().includes(needle) || row.productName.toLowerCase().includes(needle));
  }
  if (tab === 'low') data = data.filter((row) => row.low);
  if (tab === 'reserved') data = data.filter((row) => row.reserved > 0);
  if (tab === 'available') data = data.filter((row) => row.available > 0 && !row.low);
  return data;
}

async function channelAts(tenantId, masterSkuId) {
  const warehouses = await Warehouse.find({ tenantId, status: 'active' }).setOptions({ skipTenantFilter: true });
  const balances = await Inventory.find({ tenantId, masterSkuId }).setOptions({ skipTenantFilter: true });
  const byWh = {};
  balances.forEach((row) => { byWh[String(row.warehouseId)] = availableOf(row); });
  const ats = { shopify: 0, amazon: 0, myntra: 0 };
  warehouses.forEach((wh) => {
    const qty = byWh[String(wh._id)] || 0;
    if (wh.sellOnShopify) ats.shopify += qty;
    if (wh.sellOnAmazon) ats.amazon += qty;
    if (wh.sellOnMyntra) ats.myntra += qty;
  });
  return ats;
}

async function stockIn(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId }) {
  await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  const sku = await requireSku(tenantId, masterSkuId);
  const warehouse = await requireWarehouse(tenantId, warehouseId);
  await getOrCreateBalance(tenantId, sku._id, warehouse._id);
  const field = qtyField(warehouse);
  const balance = await Inventory.findOneAndUpdate(
    { tenantId, masterSkuId: sku._id, warehouseId: warehouse._id },
    { $inc: { [field]: n } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
  await appendLedger({
    tenantId,
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
    movementType: warehouse.type === 'virtual' ? 'virtual_sync' : 'purchase_receipt',
    qtyDelta: n,
    balance,
    reason: reason || 'Stock in',
    referenceType,
    referenceId,
    userId,
  });
  return mapBalance(balance, warehouse, sku);
}

async function stockOut(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId }) {
  await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  const sku = await requireSku(tenantId, masterSkuId);
  const warehouse = await requireWarehouse(tenantId, warehouseId);
  const field = qtyField(warehouse);
  const balance = await Inventory.findOneAndUpdate(
    {
      tenantId,
      masterSkuId: sku._id,
      warehouseId: warehouse._id,
      $expr: { $gte: [availableExpr, n] },
    },
    { $inc: { [field]: -n } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
  if (!balance) throw new HttpError(409, 'Not enough available stock to remove');
  await appendLedger({
    tenantId,
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
    movementType: 'adjustment_minus',
    qtyDelta: -n,
    balance,
    reason: reason || 'Stock out',
    referenceType,
    referenceId,
    userId,
  });
  return mapBalance(balance, warehouse, sku);
}

async function adjustStock(tenantId, userId, body) {
  const direction = body.direction === 'out' || body.direction === 'remove' ? 'out' : 'in';
  if (direction === 'out') return stockOut(tenantId, userId, body);
  return stockIn(tenantId, userId, { ...body, reason: body.reason || 'Adjustment plus' });
}

async function setReorderPoint(tenantId, id, reorderPoint) {
  const n = Number(reorderPoint);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Invalid reorder point');
  const row = await Inventory.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { reorderPoint: n } },
    { new: true },
  ).populate('masterSkuId').populate('warehouseId').setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Inventory row not found');
  return mapBalance(row, row.warehouseId, row.masterSkuId);
}

async function planAllocation(tenantId, masterSkuId, channel, qty) {
  const warehouses = await warehousesForChannel(tenantId, channel);
  if (!warehouses.length) throw new HttpError(400, `No warehouse sells on ${channel}`);
  const plan = [];
  let need = qty;
  for (const warehouse of warehouses) {
    if (need <= 0) break;
    const balance = await Inventory.findOne({ tenantId, masterSkuId, warehouseId: warehouse._id }).setOptions({ skipTenantFilter: true });
    const avail = balance ? availableOf(balance) : 0;
    if (avail < 1) continue;
    const take = Math.min(avail, need);
    plan.push({ warehouse, qty: take });
    need -= take;
  }
  if (need > 0) {
    throw new HttpError(409, `Out of stock on ${channel}. Need ${qty}, available ${qty - need}.`);
  }
  return plan;
}

async function atomicReserve(tenantId, masterSkuId, warehouseId, qty) {
  return Inventory.findOneAndUpdate(
    {
      tenantId,
      masterSkuId,
      warehouseId,
      $expr: { $gte: [availableExpr, qty] },
    },
    { $inc: { reservedQty: qty } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
}

async function atomicReleaseReserved(tenantId, masterSkuId, warehouseId, qty) {
  return Inventory.findOneAndUpdate(
    {
      tenantId,
      masterSkuId,
      warehouseId,
      reservedQty: { $gte: qty },
    },
    { $inc: { reservedQty: -qty } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
}

async function reverseAllocations(tenantId, masterSkuId, done) {
  for (const item of done.reverse()) {
    await atomicReleaseReserved(tenantId, masterSkuId, item.warehouse._id, item.qty);
  }
}

async function reserveStock(tenantId, userId, {
  masterSkuId, channel, qty, idempotencyKey, orderRef, reason, warehouseId,
}) {
  const n = assertQty(qty);
  const sku = await requireSku(tenantId, masterSkuId);
  const ch = String(channel || 'manual').toLowerCase();
  if (!['shopify', 'amazon', 'myntra', 'manual'].includes(ch)) throw new HttpError(400, 'Unknown channel');
  const key = String(idempotencyKey || crypto.randomUUID());
  const existing = await InventoryReservation.findOne({ tenantId, idempotencyKey: key }).setOptions({ skipTenantFilter: true });
  if (existing) {
    return { idempotent: true, status: existing.status, reservations: [existing] };
  }

  let plan;
  if (warehouseId) {
    const warehouse = await requireWarehouse(tenantId, warehouseId);
    if (ch !== 'manual' && !channelsOf(warehouse).includes(ch)) {
      throw new HttpError(400, `${warehouse.code} is not sellable on ${ch}`);
    }
    plan = [{ warehouse, qty: n }];
  } else {
    plan = await planAllocation(tenantId, sku._id, ch === 'manual' ? 'shopify' : ch, n);
  }

  const reserved = [];
  const trx = newTransactionId();
  const ref = String(orderRef || `RES-${trx}`);
  try {
    for (const slice of plan) {
      const balance = await atomicReserve(tenantId, sku._id, slice.warehouse._id, slice.qty);
      if (!balance) {
        throw new HttpError(409, `Out of stock while reserving ${slice.warehouse.code}`);
      }
      reserved.push(slice);
      const hold = await InventoryReservation.create({
        tenantId,
        masterSkuId: sku._id,
        warehouseId: slice.warehouse._id,
        orderRef: ref,
        channel: ch,
        qty: slice.qty,
        status: 'held',
        idempotencyKey: reserved.length === 1 ? key : `${key}:${slice.warehouse.code}`,
        reason: reason || 'Order reserve',
        createdBy: userId,
      });
      await appendLedger({
        tenantId,
        masterSkuId: sku._id,
        warehouseId: slice.warehouse._id,
        movementType: 'order_reserve',
        qtyDelta: 0,
        balance,
        channel: ch,
        referenceType: 'order',
        referenceId: ref,
        reason: reason || `Reserve ${slice.qty} for ${ch}`,
        userId,
        transactionId: trx,
      });
      slice.reservation = hold;
      slice.balance = balance;
    }
  } catch (err) {
    await reverseAllocations(tenantId, sku._id, reserved);
    for (const slice of reserved) {
      if (slice.reservation && slice.reservation.status === 'held') {
        slice.reservation.status = 'released';
        await slice.reservation.save();
      }
    }
    if (err.code === 11000) {
      const again = await InventoryReservation.findOne({ tenantId, idempotencyKey: key }).setOptions({ skipTenantFilter: true });
      if (again) return { idempotent: true, status: again.status, reservations: [again] };
    }
    throw err;
  }

  return {
    idempotent: false,
    status: 'held',
    orderRef: ref,
    channel: ch,
    qty: n,
    sku: sku.code,
    allocations: reserved.map((slice) => ({
      warehouse: slice.warehouse.code,
      qty: slice.qty,
      available: availableOf(slice.balance),
      reserved: slice.balance.reservedQty,
    })),
  };
}

async function releaseReservation(tenantId, userId, { orderRef, idempotencyKey, reason }) {
  const filter = { tenantId, status: 'held' };
  if (idempotencyKey) filter.idempotencyKey = idempotencyKey;
  else if (orderRef) filter.orderRef = orderRef;
  else throw new HttpError(400, 'orderRef or idempotencyKey is required');
  const holds = await InventoryReservation.find(filter).setOptions({ skipTenantFilter: true });
  if (!holds.length) throw new HttpError(404, 'No held reservation found');
  const trx = newTransactionId();
  const out = [];
  for (const hold of holds) {
    const balance = await atomicReleaseReserved(tenantId, hold.masterSkuId, hold.warehouseId, hold.qty);
    if (!balance) throw new HttpError(409, 'Could not release reservation (qty mismatch)');
    hold.status = 'released';
    await hold.save();
    await appendLedger({
      tenantId,
      masterSkuId: hold.masterSkuId,
      warehouseId: hold.warehouseId,
      movementType: 'order_release',
      qtyDelta: 0,
      balance,
      channel: hold.channel,
      referenceType: 'order',
      referenceId: hold.orderRef,
      reason: reason || 'Release reservation',
      userId,
      transactionId: trx,
    });
    out.push({ warehouseId: String(hold.warehouseId), qty: hold.qty, available: availableOf(balance) });
  }
  return { status: 'released', slices: out };
}

async function consumeReservation(tenantId, userId, { orderRef, reason }) {
  const holds = await InventoryReservation.find({ tenantId, orderRef, status: 'held' }).setOptions({ skipTenantFilter: true });
  if (!holds.length) throw new HttpError(404, 'No held reservation found');
  const trx = newTransactionId();
  const out = [];
  for (const hold of holds) {
    const warehouse = await requireWarehouse(tenantId, hold.warehouseId);
    const field = qtyField(warehouse);
    const balance = await Inventory.findOneAndUpdate(
      {
        tenantId,
        masterSkuId: hold.masterSkuId,
        warehouseId: hold.warehouseId,
        reservedQty: { $gte: hold.qty },
        [field]: { $gte: hold.qty },
      },
      { $inc: { reservedQty: -hold.qty, [field]: -hold.qty } },
      { new: true },
    ).setOptions({ skipTenantFilter: true });
    if (!balance) throw new HttpError(409, `Cannot fulfil ${warehouse.code} — reserved/on-hand mismatch`);
    hold.status = 'consumed';
    await hold.save();
    await appendLedger({
      tenantId,
      masterSkuId: hold.masterSkuId,
      warehouseId: hold.warehouseId,
      movementType: 'fulfilment_deduct',
      qtyDelta: -hold.qty,
      balance,
      channel: hold.channel,
      referenceType: 'order',
      referenceId: hold.orderRef,
      reason: reason || 'Fulfilment deduct',
      userId,
      transactionId: trx,
    });
    out.push({ warehouse: warehouse.code, qty: hold.qty, available: availableOf(balance) });
  }
  return { status: 'consumed', slices: out };
}

async function listLedger(tenantId, { masterSkuId, warehouseId, limit } = {}) {
  const filter = { tenantId };
  if (masterSkuId) filter.masterSkuId = masterSkuId;
  if (warehouseId) filter.warehouseId = warehouseId;
  const rows = await InventoryLedger.find(filter)
    .populate('masterSkuId', 'code name')
    .populate('warehouseId', 'code type')
    .sort({ recordedAt: -1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .setOptions({ skipTenantFilter: true });
  return rows.map((row) => ({
    id: String(row._id),
    transactionId: row.transactionId,
    sku: row.masterSkuId?.code || '',
    productName: row.masterSkuId?.name || '',
    warehouse: row.warehouseId?.code || '',
    qty: row.qtyDelta,
    after: row.balanceAfter,
    reservedAfter: row.reservedAfter,
    availableAfter: row.availableAfter,
    type: row.movementType,
    reason: row.reason,
    channel: row.channel,
    referenceId: row.referenceId,
    at: row.recordedAt,
  }));
}

async function lowStockAlerts(tenantId) {
  const rows = await listBalances(tenantId, { tab: 'low' });
  return rows;
}

async function stressReserve(tenantId, userId, { masterSkuId, channel, qty = 1, attempts = 10 }) {
  const n = Math.min(Math.max(Number(attempts) || 10, 2), 50);
  const stamp = Date.now();
  const jobs = Array.from({ length: n }, (_, i) => reserveStock(tenantId, userId, {
    masterSkuId,
    channel: channel || 'amazon',
    qty: qty || 1,
    idempotencyKey: `stress-${stamp}-${i}`,
    orderRef: `STRESS-${stamp}-${i}`,
    reason: 'Concurrent stress test',
  }).then((data) => ({ ok: true, orderRef: data.orderRef, allocations: data.allocations }))
    .catch((err) => ({ ok: false, message: err.message, status: err.statusCode || 500 })));
  const results = await Promise.all(jobs);
  return {
    attempts: n,
    held: results.filter((row) => row.ok).length,
    rejected: results.filter((row) => !row.ok).length,
    results,
  };
}

module.exports = {
  availableOf,
  listBalances,
  channelAts,
  stockIn,
  stockOut,
  adjustStock,
  setReorderPoint,
  reserveStock,
  releaseReservation,
  consumeReservation,
  listLedger,
  lowStockAlerts,
  stressReserve,
  mapBalance,
};
