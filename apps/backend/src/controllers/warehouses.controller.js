const { successResponse, paginatedResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const {
  listWarehouses, createWarehouse, updateWarehouse, ensureDefaultWarehouses,
  getInventoryAuthority, setInventoryAuthority,
} = require('../services/warehouse.service');
const { recordFromReq } = require('../services/auditLog.service');
const links = require('../services/channelWarehouse.service');

async function list(req, res) {
  const tenantId = merchantTenant(req);
  const data = await listWarehouses(tenantId);
  const authority = await getInventoryAuthority(tenantId);
  return successResponse(res, { warehouses: data, inventoryAuthority: authority }, 'Warehouses');
}

async function create(req, res) {
  const tenantId = merchantTenant(req);
  await ensureDefaultWarehouses(tenantId);
  const picked = Array.isArray(req.body.channels);
  if (picked) await links.markCustom(tenantId);
  const data = await createWarehouse(tenantId, picked
    ? { ...req.body, sellOnShopify: false, sellOnAmazon: false, sellOnMyntra: false }
    : req.body);
  let saved = data;
  if (picked) {
    for (const channel of req.body.channels) await links.addConnection(tenantId, { channel, warehouseId: data.id });
    const all = await listWarehouses(tenantId);
    saved = all.find((row) => row.id === data.id) || data;
  }
  await recordFromReq(req, {
    tenantId,
    action: 'warehouse.created',
    resourceType: 'warehouse',
    resourceId: saved.id,
    resourceDisplay: `${saved.code} · ${saved.name}`,
    before: null,
    after: { code: saved.code, name: saved.name, type: saved.type, channels: saved.channels },
  });
  return successResponse(res, saved, 'Warehouse created', 201);
}

async function update(req, res) {
  const tenantId = merchantTenant(req);
  const data = await updateWarehouse(tenantId, req.params.id, req.body);
  return successResponse(res, data, 'Warehouse updated');
}

async function getConfig(req, res) {
  const tenantId = merchantTenant(req);
  await ensureDefaultWarehouses(tenantId);
  const inventoryAuthority = await getInventoryAuthority(tenantId);
  return successResponse(res, {
    inventoryAuthority,
    rules: {
      shopify: 'WH-001 + WH-002',
      amazon: 'WH-001 only',
      myntra: 'WH-001 only',
    },
  }, 'Inventory config');
}

async function patchConfig(req, res) {
  const tenantId = merchantTenant(req);
  const before = await getInventoryAuthority(tenantId);
  const inventoryAuthority = await setInventoryAuthority(tenantId, req.body.inventoryAuthority);
  await recordFromReq(req, {
    tenantId,
    action: 'inventory.authority_updated',
    resourceType: 'inventory',
    resourceId: tenantId,
    resourceDisplay: 'Inventory source',
    before: { inventoryAuthority: before },
    after: { inventoryAuthority },
  });
  return successResponse(res, { inventoryAuthority }, 'Inventory source saved');
}

async function audit(req, tenantId, action, link, before, after) {
  await recordFromReq(req, {
    tenantId,
    action,
    resourceType: 'warehouse_link',
    resourceId: link.id,
    resourceDisplay: `${link.channelName} → ${link.warehouseCode}`,
    before,
    after,
  });
}

async function listLinks(req, res) {
  const data = await links.listConnections(merchantTenant(req));
  return successResponse(res, data, 'Channel ↔ warehouse links');
}

async function addLink(req, res) {
  const tenantId = merchantTenant(req);
  const data = await links.addConnection(tenantId, req.body);
  await audit(req, tenantId, 'warehouse.link_added', data, null, data);
  return successResponse(res, data, 'Link saved', 201);
}

async function updateLink(req, res) {
  const tenantId = merchantTenant(req);
  const { before, after } = await links.updateConnection(tenantId, req.params.linkId, req.body);
  await audit(req, tenantId, 'warehouse.link_updated', after, before, after);
  return successResponse(res, after, 'Link saved');
}

async function removeLink(req, res) {
  const tenantId = merchantTenant(req);
  const before = await links.removeConnection(tenantId, req.params.linkId);
  await audit(req, tenantId, 'warehouse.link_removed', before, before, null);
  return successResponse(res, { id: before.id }, 'Link removed');
}

async function deleteCheck(req, res) {
  const data = await links.deleteCheck(merchantTenant(req), req.params.id);
  return successResponse(res, data, data.canDelete ? 'Warehouse can be deleted' : 'Warehouse cannot be deleted');
}

async function remove(req, res) {
  const tenantId = merchantTenant(req);
  const removeLinks = ['1', 'true'].includes(String(req.query.removeLinks || ''));
  const data = await links.deleteWarehouse(tenantId, req.params.id, { removeLinks });
  await recordFromReq(req, {
    tenantId,
    action: 'warehouse.deleted',
    resourceType: 'warehouse',
    resourceId: data.id,
    resourceDisplay: `${data.code} · ${data.name}`,
    before: { code: data.code, name: data.name, links: data.removedLinks.map((link) => `${link.channelName} ${link.externalLocationId}`) },
    after: null,
  });
  return successResponse(res, data, `Warehouse ${data.code} deleted`);
}

async function linkHistory(req, res) {
  const data = await links.linkHistory(merchantTenant(req), { limit: req.query.limit });
  return successResponse(res, data, 'Link history');
}

async function exportLinks(req, res) {
  const setup = await links.exportSetup(merchantTenant(req));
  const day = setup.exportedAt.slice(0, 10);
  if (String(req.query.format || '').toLowerCase() === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="channel-warehouse-${day}.csv"`);
    return res.send(links.setupCsv(setup));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="channel-warehouse-${day}.json"`);
  return res.send(JSON.stringify(setup, null, 2));
}

module.exports = {
  list, create, update, remove, deleteCheck, getConfig, patchConfig, listLinks, addLink, updateLink, removeLink, linkHistory, exportLinks,
};
