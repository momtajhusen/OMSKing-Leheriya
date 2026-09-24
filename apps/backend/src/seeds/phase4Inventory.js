const MasterSku = require('../models/MasterSku');
const { ensureDefaultWarehouses } = require('../services/warehouse.service');
const { stockIn } = require('../services/inventory.service');
const Inventory = require('../models/Inventory');

async function seedLeheriyaInventory(tenantId) {
  const { physical, virtual } = await ensureDefaultWarehouses(tenantId);
  const skus = await MasterSku.find({ tenantId, status: 'active' }).sort({ createdAt: 1 }).setOptions({ skipTenantFilter: true });
  if (!skus.length) return { skipped: true, reason: 'no-skus' };

  const first = skus[0];
  const hasPhysical = await Inventory.findOne({ tenantId, masterSkuId: first._id, warehouseId: physical._id }).setOptions({ skipTenantFilter: true });
  const hasVirtual = await Inventory.findOne({ tenantId, masterSkuId: first._id, warehouseId: virtual._id }).setOptions({ skipTenantFilter: true });
  if (!hasPhysical || (hasPhysical.physicalQty || 0) < 1) {
    await stockIn(tenantId, null, {
      masterSkuId: first._id,
      warehouseId: physical._id,
      qty: 45,
      reason: 'Opening stock WH-001',
    });
  }
  if (!hasVirtual || (hasVirtual.virtualQty || 0) < 1) {
    await stockIn(tenantId, null, {
      masterSkuId: first._id,
      warehouseId: virtual._id,
      qty: 1000,
      reason: 'Virtual listing WH-002',
    });
  }

  if (skus[1]) {
    const secondPhys = await Inventory.findOne({ tenantId, masterSkuId: skus[1]._id, warehouseId: physical._id }).setOptions({ skipTenantFilter: true });
    if (!secondPhys) {
      await stockIn(tenantId, null, {
        masterSkuId: skus[1]._id,
        warehouseId: physical._id,
        qty: 8,
        reason: 'Opening stock (near reorder)',
      });
    }
  }

  return { skipped: false, sku: first.code };
}

module.exports = { seedLeheriyaInventory };
