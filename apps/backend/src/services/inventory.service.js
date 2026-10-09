const crypto = require('crypto');
const Inventory = require('../models/Inventory');
const InventoryLedger = require('../models/InventoryLedger');
const InventoryReservation = require('../models/InventoryReservation');
const Warehouse = require('../models/Warehouse');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');
const { withTransaction } = require('../lib/withTransaction');
const { firstImage } = require('../lib/catalogImages');
const {
  ensureDefaultWarehouses,
  warehousesForChannel,
  getInventoryAuthority,
  newTransactionId,
  channelsOf,
  sellsOn,
} = require('./warehouse.service');

const { channelIds, channelById } = require('../channels/registry');

const CHANNELS = channelIds();

function bucket(row, name, channel) {
  return Math.max(0, Number(row?.[name]?.[channel]) || 0);
}

function channelFree(row, channel) {
  if (!CHANNELS.includes(channel)) return 0;
  return Math.max(0, bucket(row, 'channelOnly', channel) - bucket(row, 'channelHeld', channel));
}

function availableOf(row) {
  return (row.physicalQty || 0) + (row.virtualQty || 0) - (row.reservedQty || 0);
}

function channelSellable(row, channel) {
  if (!row) return 0;
  return availableOf(row) + channelFree(row, channel);
}

function onHandOf(row) {
  const extra = CHANNELS.reduce((sum, channel) => sum + bucket(row, 'channelOnly', channel), 0);
  return (row.physicalQty || 0) + (row.virtualQty || 0) + extra;
}

function sellableSomewhere(row) {
  return availableOf(row) + CHANNELS.reduce((sum, channel) => sum + channelFree(row, channel), 0);
}

function qtyField(warehouse) {
  return warehouse.type === 'virtual' ? 'virtualQty' : 'physicalQty';
}

function assertQty(qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Quantity must be a positive integer');
  return n;
}

function exec(query, session) {
  query.setOptions({ skipTenantFilter: true });
  if (session) query.session(session);
  return query;
}

async function requireSku(tenantId, masterSkuId, session) {
  const sku = await exec(MasterSku.findOne({ _id: masterSkuId, tenantId }), session);
  if (!sku) throw new HttpError(404, 'Master SKU not found');
  return sku;
}

async function requireWarehouse(tenantId, warehouseId, session) {
  const row = await exec(Warehouse.findOne({ _id: warehouseId, tenantId, status: 'active' }), session);
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

async function getOrCreateBalance(tenantId, masterSkuId, warehouseId, session) {
  const existing = await exec(Inventory.findOne({ tenantId, masterSkuId, warehouseId }), session);
  if (existing) return existing;
  try {
    const doc = new Inventory({
      tenantId,
      masterSkuId,
      warehouseId,
      physicalQty: 0,
      virtualQty: 0,
      reservedQty: 0,
      reorderPoint: 10,
    });
    await doc.save(session ? { session } : undefined);
    return doc;
  } catch (err) {
    if (err.code === 11000) {
      return exec(Inventory.findOne({ tenantId, masterSkuId, warehouseId }), session);
    }
    throw err;
  }
}

async function appendLedger({
  tenantId, masterSkuId, warehouseId, movementType, qtyDelta, balance, channel, referenceType, referenceId, reason, userId, transactionId, session,
}) {
  const doc = new InventoryLedger({
    tenantId,
    masterSkuId,
    warehouseId,
    transactionId: transactionId || newTransactionId(),
    movementType,
    qtyDelta,
    balanceAfter: onHandOf(balance),
    reservedAfter: balance.reservedQty,
    availableAfter: sellableSomewhere(balance),
    channel: channel || '',
    referenceType: referenceType || '',
    referenceId: referenceId || '',
    reason: reason || '',
    performedBy: userId || null,
    recordedAt: new Date(),
  });
  await doc.save(session ? { session } : undefined);
  return doc;
}

function imageFromSku(sku) {
  return firstImage(sku?.productId?.images);
}

function mapBalance(row, warehouse, sku, catalogSku = sku) {
  const available = availableOf(row);
  const onHand = onHandOf(row);
  const reorderPoint = row.reorderPoint ?? 10;
  return {
    id: String(row._id),
    masterSkuId: String(row.masterSkuId._id || row.masterSkuId),
    sku: sku?.code || row.masterSkuId?.code || '',
    productName: sku?.name || row.masterSkuId?.name || '',
    imageUrl: imageFromSku(catalogSku),
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
    tracked: true,
  };
}

function emptyBalance(sku, warehouse) {
  return {
    id: `pending:${sku._id}:${warehouse._id}`,
    masterSkuId: String(sku._id),
    sku: sku.code || '',
    productName: sku.name || '',
    imageUrl: imageFromSku(sku),
    cost: sku.costPrice || 0,
    warehouseId: String(warehouse._id),
    warehouse: warehouse.code || '',
    warehouseType: warehouse.type || '',
    channels: channelsOf(warehouse),
    physicalQty: 0,
    virtualQty: 0,
    stock: 0,
    reserved: 0,
    available: 0,
    reorderPoint: null,
    safetyStock: 0,
    low: false,
    tracked: false,
  };
}

function atsForSku(warehouses, rowsByWarehouse) {
  const ats = Object.fromEntries(CHANNELS.map((id) => [id, 0]));
  warehouses.forEach((wh) => {
    const row = rowsByWarehouse.get(String(wh._id));
    const shared = row ? availableOf(row) : 0;
    CHANNELS.forEach((id) => {
      if (!sellsOn(wh, id)) return;
      ats[id] += shared + (row ? channelFree(row, id) : 0);
    });
  });
  return ats;
}

async function listBalances(tenantId, { warehouseId, q, tab } = {}) {
  await ensureDefaultWarehouses(tenantId);
  const warehouses = await exec(Warehouse.find({ tenantId, status: 'active' }).sort({ code: 1 }), null);
  const skus = await exec(MasterSku.find({ tenantId, status: 'active' }).populate('productId', 'name images').sort({ code: 1 }), null);
  const stored = await exec(Inventory.find({ tenantId }).populate('masterSkuId').populate('warehouseId'), null);
  const byKey = new Map();
  const qtyBySku = new Map();
  stored.forEach((row) => {
    const skuId = String(row.masterSkuId?._id || row.masterSkuId);
    const whId = String(row.warehouseId?._id || row.warehouseId);
    byKey.set(`${skuId}:${whId}`, row);
    if (!qtyBySku.has(skuId)) qtyBySku.set(skuId, new Map());
    qtyBySku.get(skuId).set(whId, row);
  });
  const visible = warehouseId
    ? warehouses.filter((wh) => String(wh._id) === String(warehouseId))
    : warehouses;
  let data = [];
  skus.forEach((sku) => {
    const ats = atsForSku(warehouses, qtyBySku.get(String(sku._id)) || new Map());
    visible.forEach((wh) => {
      const hit = byKey.get(`${sku._id}:${wh._id}`);
      const row = hit
        ? mapBalance(hit, hit.warehouseId || wh, hit.masterSkuId || sku, sku)
        : emptyBalance(sku, wh);
      row.ats = ats;
      data.push(row);
    });
  });
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
  const warehouses = await exec(Warehouse.find({ tenantId, status: 'active' }), null);
  const balances = await exec(Inventory.find({ tenantId, masterSkuId }), null);
  const byWh = new Map(balances.map((row) => [String(row.warehouseId), row]));
  return atsForSku(warehouses, byWh);
}

async function bumpQty(tenantId, sku, warehouse, delta, session) {
  const field = qtyField(warehouse);
  const filter = {
    tenantId,
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
  };
  if (delta < 0) filter.$expr = { $gte: [availableExpr, Math.abs(delta)] };
  const balance = await exec(
    Inventory.findOneAndUpdate(filter, { $inc: { [field]: delta } }, { new: true }),
    session,
  );
  return balance;
}

async function stockIn(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId, movementType, skipAuthorityCheck, skipNotify }) {
  if (!skipAuthorityCheck) await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  const row = await withTransaction(async (session) => {
    const sku = await requireSku(tenantId, masterSkuId, session);
    const warehouse = await requireWarehouse(tenantId, warehouseId, session);
    await getOrCreateBalance(tenantId, sku._id, warehouse._id, session);
    const balance = await bumpQty(tenantId, sku, warehouse, n, session);
    if (!balance) throw new HttpError(409, 'Could not receive stock');
    try {
      await appendLedger({
        tenantId,
        masterSkuId: sku._id,
        warehouseId: warehouse._id,
        movementType: movementType || (warehouse.type === 'virtual' ? 'virtual_sync' : 'purchase_receipt'),
        qtyDelta: n,
        balance,
        reason: reason || 'Stock in',
        referenceType,
        referenceId,
        userId,
        session,
      });
    } catch (err) {
      if (!session) await bumpQty(tenantId, sku, warehouse, -n, null);
      throw err;
    }
    return mapBalance(balance, warehouse, sku);
  });
  if (!skipNotify) await notifyChannels(tenantId, userId, masterSkuId);
  await watchLowStock(tenantId, row);
  return row;
}

function notifyChannels(tenantId, userId, masterSkuId) {
  const { queueInventoryPushes } = require('./inventoryPush.service');
  return queueInventoryPushes(tenantId, userId, masterSkuId).catch((err) => {
    console.error('[JOBS]', err.message);
  });
}

async function setChannelAvailable(tenantId, userId, { masterSkuId, warehouseId, available, reason }) {
  const target = Math.max(0, Math.floor(Number(available) || 0));
  const result = await withTransaction(async (session) => {
    const sku = await requireSku(tenantId, masterSkuId, session);
    const warehouse = await requireWarehouse(tenantId, warehouseId, session);
    await getOrCreateBalance(tenantId, sku._id, warehouse._id, session);
    const current = await exec(Inventory.findOne({ tenantId, masterSkuId: sku._id, warehouseId: warehouse._id }), session);
    const delta = target - availableOf(current);
    if (delta === 0) return { balance: mapBalance(current, warehouse, sku), changed: false };
    const balance = await exec(
      Inventory.findOneAndUpdate(
        { tenantId, masterSkuId: sku._id, warehouseId: warehouse._id },
        { $inc: { [qtyField(warehouse)]: delta } },
        { new: true },
      ),
      session,
    );
    await appendLedger({
      tenantId,
      masterSkuId: sku._id,
      warehouseId: warehouse._id,
      movementType: 'virtual_sync',
      qtyDelta: delta,
      balance,
      channel: 'shopify',
      reason: reason || 'Channel quantity wrote this warehouse',
      userId,
      session,
    });
    return { balance: mapBalance(balance, warehouse, sku), changed: true };
  });
  if (result.changed) await notifyChannels(tenantId, userId, masterSkuId);
  return result.balance;
}

async function resolveMasterSkuForChannelSku(tenantId, skuCode) {
  const SkuMapping = require('../models/SkuMapping');
  const { normalizeSkuCode } = require('./skuIdentity.service');
  const code = String(skuCode || '').trim();
  if (!code) return null;
  const norm = normalizeSkuCode(code);
  const mapped = await exec(SkuMapping.findOne({
    tenantId,
    isActive: true,
    masterSkuId: { $ne: null },
    $or: [{ channelSkuCode: code }, { channelSkuCodeNorm: norm }],
  }), null);
  if (mapped?.masterSkuId) {
    return exec(MasterSku.findOne({ _id: mapped.masterSkuId, tenantId }), null);
  }
  const direct = await exec(MasterSku.findOne({
    tenantId,
    $or: [
      { code: code.toUpperCase() },
      { code: norm },
    ],
  }), null);
  if (direct) return direct;
  return exec(MasterSku.findOne({ tenantId, name: new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }), null);
}

function channelsForDestination(destination) {
  const key = String(destination || 'All').trim().toLowerCase();
  if (key === 'none') return [];
  if (key === 'all' || key === 'all channels') return CHANNELS.slice();
  const byId = CHANNELS.find((id) => key === id || key.startsWith(id));
  if (byId) return [byId];
  const byName = CHANNELS.map((id) => channelById(id)).find((row) => key === row.name.toLowerCase());
  if (byName) return [byName.id];
  return CHANNELS.slice();
}

async function addChannelOnly(tenantId, userId, { sku, warehouse, channel, qty, reason, referenceType, referenceId, movementType }) {
  return withTransaction(async (session) => {
    await getOrCreateBalance(tenantId, sku._id, warehouse._id, session);
    const balance = await exec(
      Inventory.findOneAndUpdate(
        { tenantId, masterSkuId: sku._id, warehouseId: warehouse._id },
        { $inc: { [`channelOnly.${channel}`]: qty } },
        { new: true },
      ),
      session,
    );
    if (!balance) throw new HttpError(409, 'Could not restock this channel');
    await appendLedger({
      tenantId,
      masterSkuId: sku._id,
      warehouseId: warehouse._id,
      movementType: movementType || 'return_restock',
      qtyDelta: qty,
      balance,
      channel,
      reason: reason || `Restock ${channel} only`,
      referenceType,
      referenceId,
      userId,
      session,
    });
    return balance;
  });
}

async function offlineWarehouse(tenantId, warehouseCode) {
  await ensureDefaultWarehouses(tenantId);
  const requested = warehouseCode && warehouseCode !== 'WH-002'
    ? await exec(Warehouse.findOne({ tenantId, code: warehouseCode, status: 'active', type: 'physical' }), null)
    : null;
  if (requested) return requested;
  const offline = await exec(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }), null);
  if (!offline) throw new HttpError(404, 'WH-001 warehouse not found');
  return offline;
}

async function restockReturn(tenantId, userId, { items = [], referenceId, reason, movementType, destination, warehouseCode } = {}) {
  const selected = destination == null ? null : channelsForDestination(destination);
  const warehouse = await offlineWarehouse(tenantId, warehouseCode);
  const code = warehouse.code;
  if (selected && !selected.length) {
    return { warehouse: code, channels: [], posted: [], skipped: [] };
  }
  const onlyChannel = selected && selected.length === 1 ? selected[0] : null;
  const { queueInventoryPushes } = require('./inventoryPush.service');
  const posted = [];
  const skipped = [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.qty) || 1);
    const sku = await resolveMasterSkuForChannelSku(tenantId, item.sku);
    if (!sku) {
      skipped.push(item.sku);
      continue;
    }
    if (onlyChannel) {
      await addChannelOnly(tenantId, userId, {
        sku,
        warehouse,
        channel: onlyChannel,
        qty,
        reason: reason || `Return received — ${onlyChannel} only`,
        referenceType: 'return',
        referenceId,
        movementType: movementType || 'return_restock',
      });
    } else {
      await stockIn(tenantId, userId, {
        masterSkuId: sku._id,
        warehouseId: warehouse._id,
        qty,
        reason: reason || 'Return received — restock',
        referenceType: 'return',
        referenceId,
        movementType: movementType || 'return_restock',
        skipAuthorityCheck: true,
        skipNotify: true,
      });
    }
    await queueInventoryPushes(tenantId, userId, sku._id, selected || undefined);
    posted.push({
      sku: sku.code,
      channelSku: item.sku,
      qty,
      warehouse: code,
      channels: selected || CHANNELS.slice(),
    });
  }
  if (!posted.length) {
    throw new HttpError(400, `No Master SKU is mapped for ${skipped.join(', ') || 'these items'}. Map it on SKU Mapping first.`);
  }
  return {
    warehouse: code,
    channels: selected || CHANNELS.slice(),
    posted,
    skipped,
  };
}

async function stockOut(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId }) {
  await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  const row = await withTransaction(async (session) => {
    const sku = await requireSku(tenantId, masterSkuId, session);
    const warehouse = await requireWarehouse(tenantId, warehouseId, session);
    const balance = await bumpQty(tenantId, sku, warehouse, -n, session);
    if (!balance) throw new HttpError(409, 'Not enough available stock to remove');
    try {
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
        session,
      });
    } catch (err) {
      if (!session) await bumpQty(tenantId, sku, warehouse, n, null);
      throw err;
    }
    return mapBalance(balance, warehouse, sku);
  });
  await notifyChannels(tenantId, userId, masterSkuId);
  await watchLowStock(tenantId, row);
  return row;
}

async function adjustStock(tenantId, userId, body) {
  const direction = body.direction === 'out' || body.direction === 'remove' ? 'out' : 'in';
  if (direction === 'out') return stockOut(tenantId, userId, body);
  return stockIn(tenantId, userId, { ...body, reason: body.reason || 'Adjustment plus' });
}

async function setReorderPoint(tenantId, id, reorderPoint) {
  const n = Number(reorderPoint);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Invalid reorder point');
  let row;
  if (String(id).startsWith('pending:')) {
    const [, masterSkuId, warehouseId] = String(id).split(':');
    await requireSku(tenantId, masterSkuId);
    await requireWarehouse(tenantId, warehouseId);
    const balance = await getOrCreateBalance(tenantId, masterSkuId, warehouseId);
    balance.reorderPoint = n;
    await balance.save();
    row = await exec(Inventory.findById(balance._id).populate('masterSkuId').populate('warehouseId'), null);
  } else {
    row = await exec(
      Inventory.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { reorderPoint: n } },
        { new: true },
      ).populate('masterSkuId').populate('warehouseId'),
      null,
    );
  }
  if (!row) throw new HttpError(404, 'Inventory row not found');
  const mapped = mapBalance(row, row.warehouseId, row.masterSkuId);
  await watchLowStock(tenantId, mapped);
  return mapped;
}

async function planAllocation(tenantId, masterSkuId, channel, qty, session) {
  const warehouses = await warehousesForChannel(tenantId, channel);
  if (!warehouses.length) throw new HttpError(400, `No warehouse sells on ${channel}`);
  const plan = [];
  let need = qty;
  for (const warehouse of warehouses) {
    if (need <= 0) break;
    const balance = await exec(
      Inventory.findOne({ tenantId, masterSkuId, warehouseId: warehouse._id }),
      session,
    );
    const avail = balance ? channelSellable(balance, channel) : 0;
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

async function holdSlice(tenantId, masterSkuId, warehouse, channel, qty, session) {
  const current = await exec(
    Inventory.findOne({ tenantId, masterSkuId, warehouseId: warehouse._id }),
    session,
  );
  const ch = CHANNELS.includes(channel) && warehouse.type !== 'virtual' ? channel : '';
  const fromOnly = ch ? Math.min(channelFree(current, ch), qty) : 0;
  const fromShared = qty - fromOnly;
  const inc = {};
  const expr = [];
  if (fromShared) {
    inc.reservedQty = fromShared;
    expr.push({ $gte: [availableExpr, fromShared] });
  }
  if (fromOnly) {
    inc[`channelHeld.${ch}`] = fromOnly;
    expr.push({
      $gte: [
        {
          $subtract: [
            { $ifNull: [`$channelOnly.${ch}`, 0] },
            { $ifNull: [`$channelHeld.${ch}`, 0] },
          ],
        },
        fromOnly,
      ],
    });
  }
  const filter = { tenantId, masterSkuId, warehouseId: warehouse._id };
  if (expr.length === 1) filter.$expr = expr[0];
  else if (expr.length > 1) filter.$expr = { $and: expr };
  const balance = await exec(Inventory.findOneAndUpdate(filter, { $inc: inc }, { new: true }), session);
  return balance ? { balance, fromChannelOnly: fromOnly } : null;
}

async function releaseHold(tenantId, masterSkuId, warehouseId, qty, fromChannelOnly, channel, session) {
  const shared = qty - (fromChannelOnly || 0);
  const inc = {};
  const filter = { tenantId, masterSkuId, warehouseId };
  if (shared > 0) {
    inc.reservedQty = -shared;
    filter.reservedQty = { $gte: shared };
  }
  if (fromChannelOnly > 0 && CHANNELS.includes(channel)) {
    inc[`channelHeld.${channel}`] = -fromChannelOnly;
    filter[`channelHeld.${channel}`] = { $gte: fromChannelOnly };
  }
  if (!Object.keys(inc).length) return null;
  return exec(Inventory.findOneAndUpdate(filter, { $inc: inc }, { new: true }), session);
}

async function atomicReleaseReserved(tenantId, masterSkuId, warehouseId, qty, session) {
  return exec(
    Inventory.findOneAndUpdate(
      {
        tenantId,
        masterSkuId,
        warehouseId,
        reservedQty: { $gte: qty },
      },
      { $inc: { reservedQty: -qty } },
      { new: true },
    ),
    session,
  );
}

async function reverseAllocations(tenantId, masterSkuId, done, session, userId, trx) {
  for (const item of [...done].reverse()) {
    const balance = await releaseHold(
      tenantId,
      masterSkuId,
      item.warehouse._id,
      item.qty,
      item.fromChannelOnly || 0,
      item.channel,
      session,
    );
    if (item.reservation && item.reservation.status === 'held') {
      item.reservation.status = 'released';
      await item.reservation.save(session ? { session } : undefined);
    }
    if (balance) {
      await appendLedger({
        tenantId,
        masterSkuId,
        warehouseId: item.warehouse._id,
        movementType: 'order_release',
        qtyDelta: 0,
        balance,
        channel: item.reservation?.channel || '',
        referenceType: 'order',
        referenceId: item.reservation?.orderRef || '',
        reason: 'Reserve rolled back',
        userId,
        transactionId: trx,
        session,
      });
    }
  }
}

async function reserveInside(tenantId, userId, {
  masterSkuId, channel, qty, idempotencyKey, orderRef, reason, warehouseId, session,
}) {
  const n = assertQty(qty);
  const sku = await requireSku(tenantId, masterSkuId, session);
  const ch = String(channel || 'manual').toLowerCase();
  if (ch !== 'manual' && !CHANNELS.includes(ch)) throw new HttpError(400, 'Unknown channel');
  const key = String(idempotencyKey || crypto.randomUUID());
  const existing = await exec(
    InventoryReservation.findOne({ tenantId, idempotencyKey: key }),
    session,
  );
  if (existing) {
    return { idempotent: true, status: existing.status, reservations: [existing] };
  }

  let plan;
  if (warehouseId) {
    const warehouse = await requireWarehouse(tenantId, warehouseId, session);
    if (ch !== 'manual' && !channelsOf(warehouse).includes(ch)) {
      throw new HttpError(400, `${warehouse.code} is not sellable on ${ch}`);
    }
    plan = [{ warehouse, qty: n }];
  } else {
    plan = await planAllocation(tenantId, sku._id, ch === 'manual' ? 'shopify' : ch, n, session);
  }

  const reserved = [];
  const trx = newTransactionId();
  const ref = String(orderRef || `RES-${trx}`);
  try {
    for (const slice of plan) {
      const held = await holdSlice(tenantId, sku._id, slice.warehouse, ch, slice.qty, session);
      if (!held) {
        throw new HttpError(409, `Out of stock while reserving ${slice.warehouse.code}`);
      }
      const balance = held.balance;
      slice.fromChannelOnly = held.fromChannelOnly;
      slice.channel = ch;
      const holdKey = reserved.length === 0 ? key : `${key}:${slice.warehouse.code}`;
      const hold = new InventoryReservation({
        tenantId,
        masterSkuId: sku._id,
        warehouseId: slice.warehouse._id,
        orderRef: ref,
        channel: ch,
        qty: slice.qty,
        fromChannelOnly: held.fromChannelOnly,
        status: 'held',
        idempotencyKey: holdKey,
        reason: reason || 'Order reserve',
        createdBy: userId || null,
      });
      await hold.save(session ? { session } : undefined);
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
        session,
      });
      slice.reservation = hold;
      slice.balance = balance;
      reserved.push(slice);
    }
  } catch (err) {
    if (!session) {
      await reverseAllocations(tenantId, sku._id, reserved, null, userId, trx);
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

async function reserveStock(tenantId, userId, input) {
  const key = input.idempotencyKey ? String(input.idempotencyKey) : '';
  if (key) {
    const existing = await exec(InventoryReservation.findOne({ tenantId, idempotencyKey: key }), null);
    if (existing) {
      return { idempotent: true, status: existing.status, reservations: [existing] };
    }
  }
  try {
    const result = await withTransaction((session) => reserveInside(tenantId, userId, { ...input, session }));
    if (!result.idempotent) {
      await notifyChannels(tenantId, userId, input.masterSkuId);
      for (const slice of result.allocations || []) {
        await watchLowStock(tenantId, { sku: result.sku, warehouse: slice.warehouse, available: slice.available });
      }
    }
    return result;
  } catch (err) {
    if (err.code === 11000 && key) {
      const again = await exec(InventoryReservation.findOne({ tenantId, idempotencyKey: key }), null);
      if (again) return { idempotent: true, status: again.status, reservations: [again] };
    }
    throw err;
  }
}

async function releaseReservation(tenantId, userId, { orderRef, idempotencyKey, reason }) {
  const result = await withTransaction(async (session) => {
    const filter = { tenantId, status: 'held' };
    if (idempotencyKey) filter.idempotencyKey = idempotencyKey;
    else if (orderRef) filter.orderRef = orderRef;
    else throw new HttpError(400, 'orderRef or idempotencyKey is required');
    const holds = await exec(InventoryReservation.find(filter), session);
    if (!holds.length) throw new HttpError(404, 'No held reservation found');
    const trx = newTransactionId();
    const out = [];
    for (const hold of holds) {
      const balance = await releaseHold(
        tenantId,
        hold.masterSkuId,
        hold.warehouseId,
        hold.qty,
        hold.fromChannelOnly || 0,
        hold.channel,
        session,
      );
      if (!balance) throw new HttpError(409, 'Could not release reservation (qty mismatch)');
      hold.status = 'released';
      await hold.save(session ? { session } : undefined);
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
        session,
      });
      out.push({ warehouseId: String(hold.warehouseId), qty: hold.qty, available: availableOf(balance) });
    }
    return { status: 'released', slices: out, masterSkuId: holds[0].masterSkuId };
  });
  await notifyChannels(tenantId, userId, result.masterSkuId);
  return result;
}

async function consumeReservation(tenantId, userId, { orderRef, reason }) {
  const result = await withTransaction(async (session) => {
    const holds = await exec(
      InventoryReservation.find({ tenantId, orderRef, status: 'held' }),
      session,
    );
    if (!holds.length) throw new HttpError(404, 'No held reservation found');
    const trx = newTransactionId();
    const consumed = [];
    try {
      const out = [];
      for (const hold of holds) {
        const warehouse = await requireWarehouse(tenantId, hold.warehouseId, session);
        const field = qtyField(warehouse);
        const fromOnly = hold.fromChannelOnly || 0;
        const shared = hold.qty - fromOnly;
        const inc = {};
        const filter = {
          tenantId,
          masterSkuId: hold.masterSkuId,
          warehouseId: hold.warehouseId,
        };
        if (shared > 0) {
          inc.reservedQty = -shared;
          inc[field] = -shared;
          filter.reservedQty = { $gte: shared };
          filter[field] = { $gte: shared };
        }
        if (fromOnly > 0 && CHANNELS.includes(hold.channel)) {
          inc[`channelOnly.${hold.channel}`] = -fromOnly;
          inc[`channelHeld.${hold.channel}`] = -fromOnly;
          filter[`channelOnly.${hold.channel}`] = { $gte: fromOnly };
          filter[`channelHeld.${hold.channel}`] = { $gte: fromOnly };
        }
        const balance = await exec(
          Inventory.findOneAndUpdate(filter, { $inc: inc }, { new: true }),
          session,
        );
        if (!balance) throw new HttpError(409, `Cannot fulfil ${warehouse.code} — reserved/on-hand mismatch`);
        hold.status = 'consumed';
        await hold.save(session ? { session } : undefined);
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
          session,
        });
        consumed.push({ hold, warehouse, field, fromOnly, shared });
        out.push({ warehouse: warehouse.code, qty: hold.qty, available: availableOf(balance) });
      }
      return { status: 'consumed', slices: out, masterSkuId: holds[0].masterSkuId };
    } catch (err) {
      if (!session) {
        for (const item of consumed.reverse()) {
          const undo = {};
          if (item.shared > 0) {
            undo.reservedQty = item.shared;
            undo[item.field] = item.shared;
          }
          if (item.fromOnly > 0 && CHANNELS.includes(item.hold.channel)) {
            undo[`channelOnly.${item.hold.channel}`] = item.fromOnly;
            undo[`channelHeld.${item.hold.channel}`] = item.fromOnly;
          }
          await exec(
            Inventory.findOneAndUpdate(
              { tenantId, masterSkuId: item.hold.masterSkuId, warehouseId: item.hold.warehouseId },
              { $inc: undo },
              { new: true },
            ),
            null,
          );
          item.hold.status = 'held';
          await item.hold.save();
        }
      }
      throw err;
    }
  });
  await notifyChannels(tenantId, userId, result.masterSkuId);
  return result;
}

async function listLedger(tenantId, { masterSkuId, warehouseId, limit } = {}) {
  const filter = { tenantId };
  if (masterSkuId) filter.masterSkuId = masterSkuId;
  if (warehouseId) filter.warehouseId = warehouseId;
  const rows = await exec(
    InventoryLedger.find(filter)
      .populate({ path: 'masterSkuId', select: 'code name productId', populate: { path: 'productId', select: 'images' } })
      .populate('warehouseId', 'code type')
      .populate('performedBy', 'name email')
      .sort({ recordedAt: -1 })
      .limit(Math.min(Number(limit) || 100, 300)),
    null,
  );
  return rows.map((row) => ({
    id: String(row._id),
    transactionId: row.transactionId,
    sku: row.masterSkuId?.code || '',
    productName: row.masterSkuId?.name || '',
    imageUrl: imageFromSku(row.masterSkuId),
    warehouse: row.warehouseId?.code || '',
    qty: row.qtyDelta,
    after: row.balanceAfter,
    reservedAfter: row.reservedAfter,
    availableAfter: row.availableAfter,
    type: row.movementType,
    reason: row.reason,
    channel: row.channel,
    referenceId: row.referenceId,
    performedBy: row.performedBy?.name || row.performedBy?.email || '',
    at: row.recordedAt,
  }));
}

async function lowStockAlerts(tenantId) {
  return listBalances(tenantId, { tab: 'low' });
}

async function watchLowStock(tenantId, row) {
  if (!row?.sku && !row?.id) return;
  try {
    let doc = null;
    if (row.id && !String(row.id).startsWith('pending')) {
      doc = await exec(Inventory.findOne({ _id: row.id, tenantId }), null);
    } else if (row.sku && row.warehouse) {
      const sku = await exec(MasterSku.findOne({ tenantId, code: row.sku }), null);
      const warehouse = await exec(Warehouse.findOne({ tenantId, code: row.warehouse }), null);
      if (sku && warehouse) {
        doc = await exec(Inventory.findOne({ tenantId, masterSkuId: sku._id, warehouseId: warehouse._id }), null);
      }
    }
    if (!doc) return;
    const available = row.available != null ? Number(row.available) : availableOf(doc);
    const point = row.reorderPoint != null ? Number(row.reorderPoint) : (doc.reorderPoint ?? 10);
    const low = available <= point;
    const dedupeKey = `low:${row.sku || doc.masterSkuId}:${row.warehouse || ''}`;
    if (!low) {
      if (doc.lowStockAlertedAt) {
        doc.lowStockAlertedAt = undefined;
        await doc.save();
        const NotificationDelivery = require('../models/NotificationDelivery');
        const escaped = dedupeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await NotificationDelivery.deleteMany({ tenantId, dedupeKey: new RegExp(`^${escaped}(:|$)`) }).setOptions({ skipTenantFilter: true });
      }
      return;
    }
    if (doc.lowStockAlertedAt) return;
    const { notifyEventEmail } = require('./notify.service');
    const note = await notifyEventEmail(tenantId, 'NOT-007', {
      dedupeKey,
      subject: `Low stock ${row.sku || ''}`.trim(),
      text: `SKU: ${row.sku || '—'}\nWarehouse: ${row.warehouse || '—'}\nAvailable: ${available}`,
    });
    const sent = [note.email, note.whatsapp, note.telegram, note.inApp].some((state) => state === 'sent' || state === 'already_sent');
    if (sent) {
      doc.lowStockAlertedAt = new Date();
      await doc.save();
    }
  } catch (err) {
    console.error('[NOTIFY]', err.message);
  }
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
  channelSellable,
  listBalances,
  channelAts,
  stockIn,
  restockReturn,
  stockOut,
  adjustStock,
  setReorderPoint,
  reserveStock,
  releaseReservation,
  consumeReservation,
  setChannelAvailable,
  listLedger,
  lowStockAlerts,
  stressReserve,
  mapBalance,
};
