// SKU Mapping fixture
export const skuMappings = [
  {
    id: 'SMP-001',
    masterSku: 'MSKU-LH-001',
    channel: 'Shopify',
    channelSku: 'LHK-BL-001',
    status: 'Synced',
    lastSync: '2024-01-15T10:00:00',
  },
  {
    id: 'SMP-002',
    masterSku: 'MSKU-LH-001',
    channel: 'Amazon',
    channelSku: 'AMZ-LHK-BL-001',
    status: 'Synced',
    lastSync: '2024-01-15T10:00:00',
  },
  {
    id: 'SMP-003',
    masterSku: 'MSKU-LH-002',
    channel: 'Myntra',
    channelSku: 'MYN-CSS-PK-002',
    status: 'Error',
    lastSync: '2024-01-14T15:30:00',
    error: 'Price mismatch',
  },
];