// Shipments fixture
export const shipments = [
  {
    id: 'SHP-001',
    orderId: '65207-LEH',
    courier: 'Delhivery',
    awb: 'DLV1234567890',
    manifestId: 'MF-001',
    status: 'In Transit',
    shippedDate: '2024-01-15T10:30:00',
    estimatedDelivery: '2024-01-18T10:30:00',
    trackingEvents: [
      { status: 'Picked Up', date: '2024-01-15T10:30:00', location: 'Jaipur' },
      { status: 'In Transit', date: '2024-01-16T08:00:00', location: 'Mumbai' },
    ],
  },
  {
    id: 'SHP-002',
    orderId: '65208-LEH',
    courier: 'Bluedart',
    awb: 'BLD9876543210',
    manifestId: 'MF-002',
    status: 'Delivered',
    shippedDate: '2024-01-15T11:45:00',
    estimatedDelivery: '2024-01-18T11:45:00',
    trackingEvents: [
      { status: 'Picked Up', date: '2024-01-15T11:45:00', location: 'Mumbai' },
      { status: 'Delivered', date: '2024-01-17T14:00:00', location: 'Bengaluru' },
    ],
  },
];