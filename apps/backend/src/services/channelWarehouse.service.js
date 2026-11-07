const mongoose = require('mongoose');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const Tenant = require('../models/Tenant');
const Inventory = require('../models/Inventory');
const InventoryReservation = require('../models/InventoryReservation');
const InventoryLedger = require('../models/InventoryLedger');
const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const { HttpError } = require('../utils/httpError');
const { CHANNELS, channelById } = require('../channels/registry');
const { ensureDefaultWarehouses, linksCustom, channelsOf } = require('./warehouse.service');

const FLAG = { shopify: 'sellOnShopify', amazon: 'sellOnAmazon', myntra: 'sellOnMyntra' };
const FINISHED_ORDER = /^(delivered|cancell?ed|returned|rto|completed|closed)/i;
const skip = (query) => query.setOptions({ skipTenantFilter: true });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const channelName = (id) => channelById(id)?.name || id;

function view(map, warehouse) {
  return {
    id: String(map._id),
    channel: map.channel,
    channelName: channelName(map.channel),
    warehouseId: String(map.warehouseId),
    warehouseCode: warehouse?.code || '',
    warehouseName: warehouse?.name || '',
    warehouseType: warehouse?.type || '',
    externalLocationId: map.externalLocationId || '',
    label: map.label || '',
    isPrimaryForChannel: Boolean(map.isPrimaryForChannel),
  };
}

async function listConnections(tenantId) {
  await ensureDefaultWarehouses(tenantId);
  const [maps, warehouses] = await Promise.all([
    skip(WarehouseLocationMap.find({ tenantId })).lean(),
    skip(Warehouse.find({ tenantId }).sort({ code: 1 })).lean(),
  ]);
  const byId = Object.fromEntries(warehouses.map((row) => [String(row._id), row]));
  const order = CHANNELS.map((row) => row.id);
  const connections = maps
    .map((map) => view(map, byId[String(map.warehouseId)]))
    .sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel)
      || Number(b.isPrimaryForChannel) - Number(a.isPrimaryForChannel)
      || a.warehouseCode.localeCompare(b.warehouseCode));
  return {
    connections,
    channels: CHANNELS.map((row) => ({ id: row.id, name: row.name })),
    warehouses: warehouses.map((row) => ({
      id: String(row._id), code: row.code, name: row.name, type: row.type, status: row.status, isPickup: Boolean(row.isPickup),
    })),
  };
}

async function warehouseOf(tenantId, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Warehouse not found');
  const row = await skip(Warehouse.findOne({ _id: id, tenantId }));
  if (!row) throw new HttpError(404, 'Warehouse not found');
  return row;
}

function checkPair(channel, warehouse) {
  if (!channelById(channel)) throw new HttpError(400, 'Choose a sales channel');
  if (warehouse.type === 'virtual' && channel !== 'shopify') {
    throw new HttpError(400, `${warehouse.code} is a virtual warehouse. Its stock exists only on Shopify, so it can only be linked to Shopify.`);
  }
}

async function syncFlag(tenantId, warehouseId, channel) {
  const key = FLAG[channel];
  if (!key) return;
  const linked = await skip(WarehouseLocationMap.exists({ tenantId, warehouseId, channel }));
  await skip(Warehouse.updateOne({ _id: warehouseId, tenantId }, { $set: { [key]: Boolean(linked) } }));
}

async function makePrimary(tenantId, channel, id) {
  await skip(WarehouseLocationMap.updateMany({ tenantId, channel, _id: { $ne: id } }, { $set: { isPrimaryForChannel: false } }));
  await skip(WarehouseLocationMap.updateOne({ _id: id, tenantId }, { $set: { isPrimaryForChannel: true } }));
}

async function promoteIfNone(tenantId, channel) {
  const primary = await skip(WarehouseLocationMap.exists({ tenantId, channel, isPrimaryForChannel: true }));
  if (primary) return;
  const next = await skip(WarehouseLocationMap.findOne({ tenantId, channel }).sort({ createdAt: 1 }));
  if (next) await makePrimary(tenantId, channel, next._id);
}

/**
 * Runs before the first hand edit: every channel a warehouse already sells on becomes an explicit link, so the
 * switch to link-driven visibility loses nothing. From then on the links are the only source of truth.
 */
async function markCustom(tenantId) {
  if (await linksCustom(tenantId)) return;
  await ensureDefaultWarehouses(tenantId);
  const warehouses = await skip(Warehouse.find({ tenantId }));
  for (const warehouse of warehouses) {
    for (const channel of channelsOf(warehouse)) {
      if (await skip(WarehouseLocationMap.exists({ tenantId, channel, warehouseId: warehouse._id }))) continue;
      const externalLocationId = `${channel}-${warehouse.code.toLowerCase()}`;
      if (await skip(WarehouseLocationMap.exists({ tenantId, channel, externalLocationId }))) continue;
      await WarehouseLocationMap.create({
        tenantId, warehouseId: warehouse._id, channel, externalLocationId, label: `${channelName(channel)} · ${warehouse.name}`,
      });
      await promoteIfNone(tenantId, channel);
    }
  }
  await Tenant.updateOne({ _id: tenantId }, { $set: { 'settings.warehouseLinksCustom': true } });
}

async function clash(tenantId, channel, externalLocationId, exceptId) {
  const filter = { tenantId, channel, externalLocationId };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await skip(WarehouseLocationMap.exists(filter))) {
    throw new HttpError(409, `${channelName(channel)} location ${externalLocationId} is already linked. Edit that link instead.`);
  }
}

async function addConnection(tenantId, body = {}) {
  const channel = String(body.channel || '').toLowerCase();
  const warehouse = await warehouseOf(tenantId, body.warehouseId);
  checkPair(channel, warehouse);
  await markCustom(tenantId);
  if (await skip(WarehouseLocationMap.exists({ tenantId, channel, warehouseId: warehouse._id }))) {
    throw new HttpError(409, `${channelName(channel)} is already linked to ${warehouse.code}`);
  }
  const externalLocationId = String(body.externalLocationId || '').trim() || `${channel}-${warehouse.code.toLowerCase()}`;
  await clash(tenantId, channel, externalLocationId);
  const row = await WarehouseLocationMap.create({
    tenantId,
    warehouseId: warehouse._id,
    channel,
    externalLocationId,
    label: String(body.label || '').trim() || `${channelName(channel)} · ${warehouse.name}`,
    isPrimaryForChannel: false,
  });
  if (body.isPrimaryForChannel) await makePrimary(tenantId, channel, row._id);
  else await promoteIfNone(tenantId, channel);
  await syncFlag(tenantId, warehouse._id, channel);
  const saved = await skip(WarehouseLocationMap.findById(row._id)).lean();
  return view(saved, warehouse);
}

async function connectionOf(tenantId, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Link not found');
  const row = await skip(WarehouseLocationMap.findOne({ _id: id, tenantId }));
  if (!row) throw new HttpError(404, 'Link not found');
  return row;
}

async function updateConnection(tenantId, id, body = {}) {
  const row = await connectionOf(tenantId, id);
  const before = view(row.toObject(), await skip(Warehouse.findById(row.warehouseId)).lean());
  const oldWarehouseId = row.warehouseId;
  let warehouse = await skip(Warehouse.findOne({ _id: row.warehouseId, tenantId }));
  if (body.warehouseId != null && String(body.warehouseId) !== String(row.warehouseId)) {
    warehouse = await warehouseOf(tenantId, body.warehouseId);
    checkPair(row.channel, warehouse);
    if (await skip(WarehouseLocationMap.exists({ tenantId, channel: row.channel, warehouseId: warehouse._id, _id: { $ne: row._id } }))) {
      throw new HttpError(409, `${channelName(row.channel)} is already linked to ${warehouse.code}`);
    }
    row.warehouseId = warehouse._id;
  }
  let nextLocation = null;
  if (body.externalLocationId != null) {
    nextLocation = String(body.externalLocationId).trim();
    if (!nextLocation) throw new HttpError(400, 'Enter the channel location or warehouse id');
    await clash(tenantId, row.channel, nextLocation, row._id);
  }
  await markCustom(tenantId);
  if (nextLocation) row.externalLocationId = nextLocation;
  if (body.label != null) row.label = String(body.label).trim();
  await row.save();
  if (body.isPrimaryForChannel === true) await makePrimary(tenantId, row.channel, row._id);
  if (body.isPrimaryForChannel === false && row.isPrimaryForChannel) {
    const other = await skip(WarehouseLocationMap.findOne({ tenantId, channel: row.channel, _id: { $ne: row._id } }).sort({ createdAt: 1 }));
    if (other) await makePrimary(tenantId, row.channel, other._id);
  }
  await syncFlag(tenantId, row.warehouseId, row.channel);
  if (String(oldWarehouseId) !== String(row.warehouseId)) await syncFlag(tenantId, oldWarehouseId, row.channel);
  const saved = await skip(WarehouseLocationMap.findById(row._id)).lean();
  return { before, after: view(saved, warehouse) };
}

async function removeConnection(tenantId, id) {
  const row = await connectionOf(tenantId, id);
  const warehouse = await skip(Warehouse.findById(row.warehouseId)).lean();
  const before = view(row.toObject(), warehouse);
  await markCustom(tenantId);
  await skip(WarehouseLocationMap.deleteOne({ _id: row._id, tenantId }));
  await promoteIfNone(tenantId, row.channel);
  await syncFlag(tenantId, row.warehouseId, row.channel);
  return before;
}

/**
 * Blockers are things a delete would break right now (stock on hand, held reservations, orders still moving).
 * Warnings are shown in the confirmation but do not stop it (old history, links, pickup, last warehouse of a channel).
 */
async function deleteCheck(tenantId, id) {
  const warehouse = await warehouseOf(tenantId, id);
  const [maps, stocked, held, openOrders, history, closedOrders, shipments] = await Promise.all([
    skip(WarehouseLocationMap.find({ tenantId, warehouseId: warehouse._id })).lean(),
    skip(Inventory.countDocuments({
      tenantId,
      warehouseId: warehouse._id,
      $or: [
        { $expr: { $gt: [{ $add: ['$physicalQty', '$virtualQty', '$reservedQty'] }, 0] } },
        ...CHANNELS.map((row) => row.id).flatMap((id) => [{ [`channelOnly.${id}`]: { $gt: 0 } }, { [`channelHeld.${id}`]: { $gt: 0 } }]),
      ],
    })),
    skip(InventoryReservation.countDocuments({ tenantId, warehouseId: warehouse._id, status: 'held' })),
    skip(Order.countDocuments({ tenantId, warehouseCode: warehouse.code, status: { $not: FINISHED_ORDER } })),
    skip(InventoryLedger.countDocuments({ tenantId, warehouseId: warehouse._id })),
    skip(Order.countDocuments({ tenantId, warehouseCode: warehouse.code, status: FINISHED_ORDER })),
    skip(Shipment.countDocuments({ tenantId, warehouseCode: warehouse.code })),
  ]);
  const blockers = [];
  if (stocked) blockers.push(`${plural(stocked, 'product')} still have stock here. Move it or adjust it to 0 first.`);
  if (held) blockers.push(`${plural(held, 'order reservation')} still hold stock here.`);
  if (openOrders) blockers.push(`${plural(openOrders, 'open order')} ship from ${warehouse.code}. Finish or move them first.`);

  const warnings = [];
  const links = maps.map((map) => view(map, warehouse));
  if (links.length) warnings.push(`Its ${plural(links.length, 'channel link')} (${links.map((l) => l.channelName).join(', ')}) will be removed.`);
  for (const link of links) {
    const others = await skip(WarehouseLocationMap.countDocuments({ tenantId, channel: link.channel, warehouseId: { $ne: warehouse._id } }));
    if (!others) warnings.push(`${link.channelName} will have no warehouse left, so it shows no stock until you link one.`);
  }
  if (warehouse.isPickup) warnings.push(`${warehouse.code} is a courier pickup address. Set another pickup before booking.`);
  if (history) warnings.push(`${plural(history, 'past stock movement')} stay in the history under ${warehouse.code}.`);
  if (closedOrders || shipments) warnings.push(`Finished orders and shipments keep showing ${warehouse.code} as text.`);
  return {
    warehouse: { id: String(warehouse._id), code: warehouse.code, name: warehouse.name },
    canDelete: blockers.length === 0,
    blockers,
    warnings,
    links,
  };
}

async function deleteWarehouse(tenantId, id, { removeLinks = false } = {}) {
  const check = await deleteCheck(tenantId, id);
  if (!check.canDelete) throw new HttpError(409, `${check.warehouse.code} cannot be deleted. ${check.blockers.join(' ')}`, check.blockers);
  if (check.links.length && !removeLinks) {
    throw new HttpError(409, `${check.warehouse.code} is linked to ${plural(check.links.length, 'channel')}. Confirm to remove the links too.`, check.links);
  }
  await markCustom(tenantId);
  const warehouseId = check.warehouse.id;
  await skip(WarehouseLocationMap.deleteMany({ tenantId, warehouseId }));
  for (const channel of new Set(check.links.map((link) => link.channel))) await promoteIfNone(tenantId, channel);
  await skip(Inventory.deleteMany({ tenantId, warehouseId }));
  await skip(Warehouse.deleteOne({ _id: warehouseId, tenantId }));
  return { ...check.warehouse, removedLinks: check.links };
}

const HISTORY_ACTIONS = {
  'warehouse.created': 'Warehouse added',
  'warehouse.deleted': 'Warehouse deleted',
  'warehouse.link_added': 'Link added',
  'warehouse.link_updated': 'Link changed',
  'warehouse.link_removed': 'Link removed',
};

function historyDetail(row) {
  const link = row.after || row.before || {};
  if (row.action === 'warehouse.link_updated') {
    const changes = [];
    const before = row.before || {};
    const after = row.after || {};
    if (before.warehouseCode !== after.warehouseCode) changes.push(`warehouse ${before.warehouseCode} → ${after.warehouseCode}`);
    if (before.externalLocationId !== after.externalLocationId) changes.push(`location ${before.externalLocationId || '—'} → ${after.externalLocationId || '—'}`);
    if (before.label !== after.label) changes.push('label');
    if (before.isPrimaryForChannel !== after.isPrimaryForChannel) changes.push(after.isPrimaryForChannel ? 'made main' : 'no longer main');
    return changes.join(', ') || 'saved';
  }
  if (row.action === 'warehouse.deleted') return (row.before?.links || []).length ? `links removed: ${row.before.links.join(', ')}` : '';
  if (row.action === 'warehouse.created') return (row.after?.channels || []).join(', ');
  return link.externalLocationId || '';
}

/** Who changed which link or warehouse and when, newest first, from the audit log. */
async function linkHistory(tenantId, { limit = 25 } = {}) {
  const AuditLog = require('../models/AuditLog');
  const rows = await skip(AuditLog.find({ tenantId, action: { $in: Object.keys(HISTORY_ACTIONS) } })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 25, 1), 100))
    .populate({ path: 'actorId', select: 'fullName email' })).lean();
  return rows.map((row) => {
    const link = row.after || row.before || {};
    return {
      id: String(row._id),
      at: row.createdAt,
      user: row.actorId?.fullName || row.actorId?.email || 'System',
      action: HISTORY_ACTIONS[row.action],
      channel: link.channelName || '',
      warehouse: link.warehouseCode || link.code || '',
      detail: historyDetail(row),
    };
  });
}

/** Everything needed to set the warehouses and links up again on a fresh account. */
async function exportSetup(tenantId) {
  const [tenant, warehouses, maps] = await Promise.all([
    Tenant.findById(tenantId).select('name').lean(),
    skip(Warehouse.find({ tenantId }).sort({ code: 1 })).lean(),
    skip(WarehouseLocationMap.find({ tenantId })).lean(),
  ]);
  const byId = Object.fromEntries(warehouses.map((row) => [String(row._id), row]));
  const order = CHANNELS.map((row) => row.id);
  return {
    format: 'omsking.channel-warehouse.v1',
    exportedAt: new Date().toISOString(),
    company: tenant?.name || '',
    warehouses: warehouses.map((row) => ({
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      isPickup: Boolean(row.isPickup),
      address: row.address || {},
      contactPerson: row.contactPerson || '',
      contactPhone: row.contactPhone || '',
    })),
    links: maps
      .map((map) => ({
        channel: map.channel,
        channelName: channelName(map.channel),
        warehouseCode: byId[String(map.warehouseId)]?.code || '',
        externalLocationId: map.externalLocationId || '',
        label: map.label || '',
        isPrimaryForChannel: Boolean(map.isPrimaryForChannel),
      }))
      .sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel) || a.warehouseCode.localeCompare(b.warehouseCode)),
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function setupCsv(setup) {
  const names = Object.fromEntries(setup.warehouses.map((row) => [row.code, row]));
  const head = ['Channel', 'Warehouse code', 'Warehouse name', 'Warehouse type', 'Warehouse status', 'Channel location id', 'Label', 'Main warehouse'];
  const linked = new Set(setup.links.map((link) => link.warehouseCode));
  const rows = setup.links.map((link) => [
    link.channelName, link.warehouseCode, names[link.warehouseCode]?.name, names[link.warehouseCode]?.type,
    names[link.warehouseCode]?.status, link.externalLocationId, link.label, link.isPrimaryForChannel ? 'Yes' : 'No',
  ]);
  setup.warehouses.filter((row) => !linked.has(row.code))
    .forEach((row) => rows.push(['', row.code, row.name, row.type, row.status, '', '', '']));
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/**
 * Which OMSKing warehouse each order ships from: the order's own warehouse code when it is one of ours or a linked
 * channel location id (Myntra sends its own warehouse id), else the channel's main warehouse.
 */
async function warehouseResolver(tenantId) {
  const [warehouses, maps] = await Promise.all([
    skip(Warehouse.find({ tenantId })).select('code name').lean(),
    skip(WarehouseLocationMap.find({ tenantId })).select('channel warehouseId externalLocationId isPrimaryForChannel').lean(),
  ]);
  const byId = Object.fromEntries(warehouses.map((row) => [String(row._id), row]));
  const byCode = Object.fromEntries(warehouses.map((row) => [row.code, row]));
  const pick = (row, source) => (row ? { code: row.code, name: row.name, source } : null);
  return (order) => {
    const key = String(order.channel || '').trim().toLowerCase();
    const channel = channelById(key)?.id || CHANNELS.find((row) => row.name.toLowerCase() === key)?.id || '';
    const own = String(order.warehouseCode || '').trim();
    if (own) {
      const location = maps.find((map) => map.channel === channel && map.externalLocationId === own);
      if (location) return pick(byId[String(location.warehouseId)], 'channel location');
      if (byCode[own.toUpperCase()]) return pick(byCode[own.toUpperCase()], 'order');
    }
    const main = maps.find((map) => map.channel === channel && map.isPrimaryForChannel);
    return main ? pick(byId[String(main.warehouseId)], 'main warehouse') : null;
  };
}

module.exports = {
  listConnections, addConnection, updateConnection, removeConnection, deleteCheck, deleteWarehouse, markCustom,
  linkHistory, exportSetup, setupCsv, warehouseResolver,
};
