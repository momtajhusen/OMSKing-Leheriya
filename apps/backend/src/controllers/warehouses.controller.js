const { successResponse, paginatedResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const {
  listWarehouses, createWarehouse, updateWarehouse, ensureDefaultWarehouses,
  getInventoryAuthority, setInventoryAuthority,
} = require('../services/warehouse.service');

async function list(req, res) {
  const tenantId = merchantTenant(req);
  const data = await listWarehouses(tenantId);
  const authority = await getInventoryAuthority(tenantId);
  return successResponse(res, { warehouses: data, inventoryAuthority: authority }, 'Warehouses');
}

async function create(req, res) {
  const tenantId = merchantTenant(req);
  await ensureDefaultWarehouses(tenantId);
  const data = await createWarehouse(tenantId, req.body);
  return successResponse(res, data, 'Warehouse created', 201);
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
  const inventoryAuthority = await setInventoryAuthority(tenantId, req.body.inventoryAuthority);
  return successResponse(res, { inventoryAuthority }, 'Inventory source saved');
}

module.exports = { list, create, update, getConfig, patchConfig };
