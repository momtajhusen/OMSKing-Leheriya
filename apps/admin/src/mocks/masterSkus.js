// Master SKU fixture
export const masterSkus = [
  {
    id: 'MSKU-LH-001',
    code: 'MSKU-LH-001',
    name: 'Leheriya Kurta',
    category: 'Kurtas',
    attributes: { color: 'Blue', fabric: 'Cotton', pattern: 'Leheriya' },
    stock: 45,
    channelMappings: [
      { channel: 'Shopify', sku: 'LHK-BL-001', status: 'Synced' },
      { channel: 'Amazon', sku: 'AMZ-LHK-BL-001', status: 'Synced' },
      { channel: 'Myntra', sku: 'MYN-LHK-BL-001', status: 'Synced' },
    ],
  },
  {
    id: 'MSKU-LH-002',
    code: 'MSKU-LH-002',
    name: 'Cotton Saree',
    category: 'Sarees',
    attributes: { color: 'Pink', fabric: 'Cotton', pattern: 'Plain' },
    stock: 30,
    channelMappings: [
      { channel: 'Shopify', sku: 'CSS-PK-002', status: 'Synced' },
      { channel: 'Amazon', sku: 'AMZ-CSS-PK-002', status: 'Pending' },
      { channel: 'Myntra', sku: 'MYN-CSS-PK-002', status: 'Error', error: 'Price mismatch' },
    ],
  },
  {
    id: 'MSKU-LH-003',
    code: 'MSKU-LH-003',
    name: 'Bandhani Saree',
    category: 'Sarees',
    attributes: { color: 'Red', fabric: 'Silk Blend', pattern: 'Bandhani' },
    stock: 25,
    channelMappings: [
      { channel: 'Shopify', sku: 'BNS-RD-003', status: 'Synced' },
      { channel: 'Amazon', sku: 'AMZ-BNS-RD-003', status: 'Synced' },
      { channel: 'Myntra', sku: 'MYN-BNS-RD-003', status: 'Synced' },
    ],
  },
  {
    id: 'MSKU-LH-004',
    code: 'MSKU-LH-004',
    name: 'Lehenga',
    category: 'Lehengas',
    attributes: { color: 'Maroon', fabric: 'Velvet', pattern: 'Embroidered' },
    stock: 15,
    channelMappings: [
      { channel: 'Shopify', sku: 'LHG-MR-004', status: 'Synced' },
      { channel: 'Amazon', sku: 'AMZ-LHG-MR-004', status: 'Synced' },
      { channel: 'Myntra', sku: 'MYN-LHG-MR-004', status: 'Synced' },
    ],
  },
  {
    id: 'MSKU-LH-005',
    code: 'MSKU-LH-005',
    name: 'Anarkali Suit',
    category: 'Suits',
    attributes: { color: 'Green', fabric: 'Georgette', pattern: 'Printed' },
    stock: 20,
    channelMappings: [
      { channel: 'Shopify', sku: 'ANS-GR-005', status: 'Synced' },
      { channel: 'Amazon', sku: 'AMZ-ANS-GR-005', status: 'Pending' },
      { channel: 'Myntra', sku: 'MYN-ANS-GR-005', status: 'Synced' },
    ],
  },
];