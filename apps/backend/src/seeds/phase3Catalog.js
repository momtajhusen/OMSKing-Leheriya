const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { ingestListing, createMasterForListing } = require('../services/catalogMapping.service');

async function seedLeheriyaCatalog(tenantId) {
  const existing = await Product.findOne({ tenantId, name: 'Leheriya Kurta' }).setOptions({ skipTenantFilter: true });
  if (existing) return { skipped: true };

  const shopify = await ingestListing(tenantId, null, {
    channel: 'shopify',
    channelSkuCode: 'LHK-BL-001',
    channelVariantId: 'gid://shopify/ProductVariant/1001',
    channelProductId: 'gid://shopify/Product/100',
    channelTitle: 'Leheriya Kurta Blue',
    barcode: '8901000000001',
    price: 1899,
  });
  if (shopify.action === 'unmapped') {
    await createMasterForListing(tenantId, null, shopify.mapping, {
      name: 'Leheriya Kurta',
      category: 'Kurtas',
      hsnCode: '6204',
      gstRatePercent: 5,
      variantAttributes: { color: 'Blue', fabric: 'Cotton' },
      barcode: '8901000000001',
      sellingPrice: 1899,
      mrp: 2499,
    });
  }

  await ingestListing(tenantId, null, {
    channel: 'myntra',
    channelSkuCode: 'LHK-BL-001',
    channelVariantId: 'MYN-LHK-BL-001',
    channelTitle: 'Leheriya Kurta Blue',
    barcode: '8901000000001',
    price: 1899,
  });
  await ingestListing(tenantId, null, {
    channel: 'amazon',
    channelSkuCode: 'LHK-BL-001',
    channelVariantId: 'AMZ-LHK-BL-001',
    channelTitle: 'Leheriya Kurta Blue',
    barcode: '8901000000001',
    price: 1899,
  });

  await ingestListing(tenantId, null, {
    channel: 'amazon',
    channelSkuCode: 'AMZ-CKK-WH-013',
    channelVariantId: 'AMZ-CKK-WH-013',
    channelTitle: 'Chikankari Kurta White',
    price: 1599,
  });
  await ingestListing(tenantId, null, {
    channel: 'myntra',
    channelSkuCode: 'MYN-PHD-RD-015',
    channelVariantId: 'MYN-PHD-RD-015',
    channelTitle: 'Phulkari Dupatta Red',
    price: 899,
  });

  const failed = await ingestListing(tenantId, null, {
    channel: 'myntra',
    channelSkuCode: 'CSS-PK-002',
    channelVariantId: 'MYN-CSS-PK-002',
    channelTitle: 'Cotton Saree Pink',
    barcode: '8901000000002',
    price: 2199,
  });
  if (failed.action === 'unmapped') {
    await createMasterForListing(tenantId, null, failed.mapping, {
      name: 'Cotton Saree',
      category: 'Sarees',
      hsnCode: '5407',
      variantAttributes: { color: 'Pink', fabric: 'Cotton' },
      barcode: '8901000000002',
      sellingPrice: 2199,
    });
  }
  failed.mapping.syncStatus = 'error';
  failed.mapping.lastSyncError = 'Price mismatch on Myntra';
  await failed.mapping.save();

  return { skipped: false };
}

module.exports = { seedLeheriyaCatalog };
