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
    availableAfter: availableOf(balance),
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

function atsForSku(warehouses, qtyByWarehouse) {
  const ats = { shopify: 0, amazon: 0, myntra: 0 };
  warehouses.forEach((wh) => {
    const qty = qtyByWarehouse.get(String(wh._id)) || 0;
    if (wh.sellOnShopify) ats.shopify += qty;
    if (wh.sellOnAmazon) ats.amazon += qty;
    if (wh.sellOnMyntra) ats.myntra += qty;
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
    qtyBySku.get(skuId).set(whId, availableOf(row));
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

async function stockIn(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId, movementType, skipAuthorityCheck }) {
  if (!skipAuthorityCheck) await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  return withTransaction(async (session) => {
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

async function restockReturn(tenantId, userId, { items = [], referenceId, reason } = {}) {
  await ensureDefaultWarehouses(tenantId);
  const warehouse = await exec(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }), null);
  if (!warehouse) throw new HttpError(404, 'WH-001 Offline warehouse not found');
  const posted = [];
  const skipped = [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.qty) || 1);
    const sku = await resolveMasterSkuForChannelSku(tenantId, item.sku);
    if (!sku) {
      skipped.push(item.sku);
      continue;
    }
    await stockIn(tenantId, userId, {
      masterSkuId: sku._id,
      warehouseId: warehouse._id,
      qty,
      reason: reason || 'Return approved — restock Offline WH-001; Amazon + Myntra ATS',
      referenceType: 'return',
      referenceId,
      movementType: 'return_restock',
      skipAuthorityCheck: true,
    });
    posted.push({
      sku: sku.code,
      channelSku: item.sku,
      qty,
      warehouse: 'WH-001',
      channels: ['shopify', 'amazon', 'myntra'],
    });
  }
  if (!posted.length) {
    throw new HttpError(400, `No Master SKU is mapped for ${skipped.join(', ') || 'these items'}. Map it on SKU Mapping first.`);
  }
  return {
    warehouse: 'WH-001',
    channels: ['shopify', 'amazon', 'myntra'],
    posted,
    skipped,
  };
}

async function stockOut(tenantId, userId, { masterSkuId, warehouseId, qty, reason, referenceType, referenceId }) {
  await assertOmsMaster(tenantId);
  const n = assertQty(qty);
  return withTransaction(async (session) => {
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
  return mapBalance(row, row.warehouseId, row.masterSkuId);
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

async function atomicReserve(tenantId, masterSkuId, warehouseId, qty, session) {
  return exec(
    Inventory.findOneAndUpdate(
      {
        tenantId,
        masterSkuId,
        warehouseId,
        $expr: { $gte: [availableExpr, qty] },
      },
      { $inc: { reservedQty: qty } },
      { new: true },
    ),
    session,
  );
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
    const balance = await atomicReleaseReserved(tenantId, masterSkuId, item.warehouse._id, item.qty, session);
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
  if (!['shopify', 'amazon', 'myntra', 'manual'].includes(ch)) throw new HttpError(400, 'Unknown channel');
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
      const balance = await atomicReserve(tenantId, sku._id, slice.warehouse._id, slice.qty, session);
      if (!balance) {
        throw new HttpError(409, `Out of stock while reserving ${slice.warehouse.code}`);
      }
      const holdKey = reserved.length === 0 ? key : `${key}:${slice.warehouse.code}`;
      const hold = new InventoryReservation({
        tenantId,
        masterSkuId: sku._id,
        warehouseId: slice.warehouse._id,
        orderRef: ref,
        channel: ch,
        qty: slice.qty,
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
    return await withTransaction((session) => reserveInside(tenantId, userId, { ...input, session }));
  } catch (err) {
    if (err.code === 11000 && key) {
      const again = await exec(InventoryReservation.findOne({ tenantId, idempotencyKey: key }), null);
      if (again) return { idempotent: true, status: again.status, reservations: [again] };
    }
    throw err;
  }
}

async function releaseReservation(tenantId, userId, { orderRef, idempotencyKey, reason }) {
  return withTransaction(async (session) => {
    const filter = { tenantId, status: 'held' };
    if (idempotencyKey) filter.idempotencyKey = idempotencyKey;
    else if (orderRef) filter.orderRef = orderRef;
    else throw new HttpError(400, 'orderRef or idempotencyKey is required');
    const holds = await exec(InventoryReservation.find(filter), session);
    if (!holds.length) throw new HttpError(404, 'No held reservation found');
    const trx = newTransactionId();
    const out = [];
    for (const hold of holds) {
      const balance = await atomicReleaseReserved(tenantId, hold.masterSkuId, hold.warehouseId, hold.qty, session);
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
    return { status: 'released', slices: out };
  });
}

async function consumeReservation(tenantId, userId, { orderRef, reason }) {
  return withTransaction(async (session) => {
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
        const balance = await exec(
          Inventory.findOneAndUpdate(
            {
              tenantId,
              masterSkuId: hold.masterSkuId,
              warehouseId: hold.warehouseId,
              reservedQty: { $gte: hold.qty },
              [field]: { $gte: hold.qty },
            },
            { $inc: { reservedQty: -hold.qty, [field]: -hold.qty } },
            { new: true },
          ),
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
        consumed.push({ hold, warehouse, field });
        out.push({ warehouse: warehouse.code, qty: hold.qty, available: availableOf(balance) });
      }
      return { status: 'consumed', slices: out };
    } catch (err) {
      if (!session) {
        for (const item of consumed.reverse()) {
          await exec(
            Inventory.findOneAndUpdate(
              { tenantId, masterSkuId: item.hold.masterSkuId, warehouseId: item.hold.warehouseId },
              { $inc: { reservedQty: item.hold.qty, [item.field]: item.hold.qty } },
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
  restockReturn,
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
