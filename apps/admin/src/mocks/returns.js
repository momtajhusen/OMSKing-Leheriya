// Returns fixture
export const returns = [
  {
    id: 'RET-001',
    orderId: '65211-LEH',
    customer: 'Vikram Singh',
    reason: 'Size mismatch',
    status: 'QC Pending',
    requestDate: '2024-01-12T16:00:00',
    restockDestination: 'Shopify(Offline)',
    items: [{ sku: 'SHW-NV-006', qty: 1, price: 7999 }],
  },
  {
    id: 'RET-002',
    orderId: '65212-LEH',
    customer: 'Neha Verma',
    reason: 'Defective product',
    status: 'Approved',
    requestDate: '2024-01-11T08:30:00',
    restockDestination: 'Myntra',
    items: [{ sku: 'KRT-YL-007', qty: 2, price: 699 }],
  },
];