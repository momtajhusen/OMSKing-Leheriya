const crypto = require('crypto');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');

function channelsOf(warehouse) {
  const list = [];
  if (warehouse.sellOnShopify) list.push('shopify');
  if (warehouse.sellOnAmazon) list.push('amazon');
  if (warehouse.sellOnMyntra) list.push('myntra');
  return list;
}

function mapWarehouse(row, locations = []) {
  return {
    id: String(row._id),
    code: row.code,
    name: row.name,
    type: row.type,
    isDefault: row.isDefault,
    sellOnShopify: row.sellOnShopify,
    sellOnAmazon: row.sellOnAmazon,
    sellOnMyntra: row.sellOnMyntra,
    channels: channelsOf(row),
    isPickup: row.isPickup,
    address: row.address || {},
    contactPerson: row.contactPerson || '',
    contactPhone: row.contactPhone || '',
    status: row.status,
    locations: locations.map((loc) => ({
      id: String(loc._id),
      channel: loc.channel,
      externalLocationId: loc.externalLocationId,
      label: loc.label,
      isPrimaryForChannel: loc.isPrimaryForChannel,
    })),
  };
}

async function findOrCreate(Model, filter, doc) {
  const existing = await Model.findOne(filter).setOptions({ skipTenantFilter: true });
  if (existing) return existing;
  try {
    return await Model.create(doc);
  } catch (err) {
    if (err.code === 11000) {
      return Model.findOne(filter).setOptions({ skipTenantFilter: true });
    }
    throw err;
  }
}

async function ensureDefaultWarehouses(tenantId) {
  const physical = await findOrCreate(
    Warehouse,
    { tenantId, code: 'WH-001' },
    {
      tenantId,
      code: 'WH-001',
      name: 'Physical / Offline',
      type: 'physical',
      isDefault: true,
      sellOnShopify: true,
      sellOnAmazon: true,
      sellOnMyntra: true,
      isPickup: true,
      status: 'active',
    },
  );
  const virtual = await findOrCreate(
    Warehouse,
    { tenantId, code: 'WH-002' },
    {
      tenantId,
      code: 'WH-002',
      name: 'Virtual / Shopify only',
      type: 'virtual',
      isDefault: false,
      sellOnShopify: true,
      sellOnAmazon: false,
      sellOnMyntra: false,
      isPickup: false,
      status: 'active',
    },
  );

  const defaults = [
    { warehouseId: physical._id, channel: 'shopify', externalLocationId: 'shopify-location-a', label: 'Shopify Location A (Offline)', isPrimaryForChannel: true },
    { warehouseId: virtual._id, channel: 'shopify', externalLocationId: 'shopify-location-b', label: 'Shopify Location B (Virtual)', isPrimaryForChannel: false },
    { warehouseId: physical._id, channel: 'amazon', externalLocationId: 'amazon-wh-001', label: 'Amazon inventory', isPrimaryForChannel: true },
    { warehouseId: physical._id, channel: 'myntra', externalLocationId: 'myntra-wh-001', label: 'Myntra inventory', isPrimaryForChannel: true },
  ];
  for (const row of defaults) {
    await findOrCreate(
      WarehouseLocationMap,
      { tenantId, channel: row.channel, externalLocationId: row.externalLocationId },
      { tenantId, ...row },
    );
  }
  return { physical, virtual };
}

async function listWarehouses(tenantId) {
  await ensureDefaultWarehouses(tenantId);
  const rows = await Warehouse.find({ tenantId }).sort({ code: 1 }).setOptions({ skipTenantFilter: true });
  const maps = await WarehouseLocationMap.find({ tenantId }).setOptions({ skipTenantFilter: true });
  const byWh = {};
  maps.forEach((loc) => {
    const key = String(loc.warehouseId);
    byWh[key] = byWh[key] || [];
    byWh[key].push(loc);
  });
  return rows.map((row) => mapWarehouse(row, byWh[String(row._id)] || []));
}

async function createWarehouse(tenantId, body) {
  const type = body.type === 'virtual' ? 'virtual' : 'physical';
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) throw new HttpError(400, 'Warehouse code is required');
  const clash = await Warehouse.findOne({ tenantId, code }).setOptions({ skipTenantFilter: true });
  if (clash) throw new HttpError(409, `Warehouse ${code} already exists`);
  const row = await Warehouse.create({
    tenantId,
    code,
    name: body.name || code,
    type,
    isDefault: Boolean(body.isDefault),
    sellOnShopify: body.sellOnShopify !== false,
    sellOnAmazon: type === 'physical' && body.sellOnAmazon !== false,
    sellOnMyntra: type === 'physical' && body.sellOnMyntra !== false,
    isPickup: type === 'physical' && body.isPickup !== false,
    address: body.address || {},
    contactPerson: body.contactPerson || '',
    contactPhone: body.contactPhone || '',
    status: body.status || 'active',
  });
  return mapWarehouse(row, []);
}

async function updateWarehouse(tenantId, id, body) {
  const row = await Warehouse.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Warehouse not found');
  ['name', 'contactPerson', 'contactPhone', 'status'].forEach((key) => {
    if (body[key] != null) row[key] = body[key];
  });
  if (body.address) row.address = { ...row.address.toObject?.() || row.address, ...body.address };
  if (body.sellOnShopify != null) row.sellOnShopify = Boolean(body.sellOnShopify);
  if (row.type === 'physical') {
    if (body.sellOnAmazon != null) row.sellOnAmazon = Boolean(body.sellOnAmazon);
    if (body.sellOnMyntra != null) row.sellOnMyntra = Boolean(body.sellOnMyntra);
    if (body.isPickup != null) row.isPickup = Boolean(body.isPickup);
  } else {
    row.sellOnAmazon = false;
    row.sellOnMyntra = false;
    row.isPickup = false;
  }
  await row.save();
  const locations = await WarehouseLocationMap.find({ tenantId, warehouseId: row._id }).setOptions({ skipTenantFilter: true });
  return mapWarehouse(row, locations);
}

async function warehousesForChannel(tenantId, channel) {
  await ensureDefaultWarehouses(tenantId);
  const flag = channel === 'amazon' ? 'sellOnAmazon' : channel === 'myntra' ? 'sellOnMyntra' : 'sellOnShopify';
  const rows = await Warehouse.find({ tenantId, status: 'active', [flag]: true }).sort({ isDefault: -1, code: 1 }).setOptions({ skipTenantFilter: true });
  return rows;
}

async function getInventoryAuthority(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  return tenant?.settings?.inventoryAuthority === 'shopify' ? 'shopify' : 'oms';
}

async function setInventoryAuthority(tenantId, value) {
  if (!['oms', 'shopify'].includes(value)) throw new HttpError(400, 'inventoryAuthority must be oms or shopify');
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  tenant.settings = tenant.settings || {};
  tenant.settings.inventoryAuthority = value;
  await tenant.save();
  return value;
}

function newTransactionId() {
  return `TRX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

module.exports = {
  channelsOf,
  mapWarehouse,
  ensureDefaultWarehouses,
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  warehousesForChannel,
  getInventoryAuthority,
  setInventoryAuthority,
  newTransactionId,
};
