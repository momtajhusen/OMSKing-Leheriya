// Warehouses fixture.
// channels drives the core visibility rule:
// Offline (physical) stock is sellable on all three channels;
// Virtual stock is Shopify-only, because Amazon and Myntra only allow
// selling what is physically in hand.
export const warehouses = [
  {
    id: 'WH-001',
    name: 'WH-001 Offline Mumbai',
    type: 'Offline',
    location: 'Mumbai, Maharashtra',
    address: '123 Industrial Area, Andheri East, Mumbai, Maharashtra',
    capacity: 5000,
    currentStock: 3250,
    channels: ['Shopify', 'Amazon', 'Myntra'],
    shopifyLocation: 'Shopify Location A — Offline',
    status: 'Active',
    isPickup: true,
  },
  {
    id: 'WH-002',
    name: 'WH-002 Virtual Shopify',
    type: 'Virtual',
    location: 'Jaipur, Rajasthan',
    address: '456 Tech Park, Jaipur, Rajasthan',
    capacity: 10000,
    currentStock: 6780,
    channels: ['Shopify'],
    shopifyLocation: 'Shopify Location B — Virtual',
    status: 'Active',
    isPickup: false,
  },
  {
    id: 'WH-003',
    name: 'WH-003 Offline Jaipur',
    type: 'Offline',
    location: 'Jaipur, Rajasthan',
    address: '789 Warehouse Road, Jaipur, Rajasthan',
    capacity: 3500,
    currentStock: 2100,
    channels: ['Shopify', 'Amazon', 'Myntra'],
    shopifyLocation: '',
    status: 'Active',
    isPickup: true,
  },
  {
    id: 'WH-004',
    name: 'WH-004 Return Hub Delhi',
    type: 'Return Hub',
    location: 'Delhi, Delhi',
    address: '321 Returns Complex, Delhi, Delhi',
    capacity: 2000,
    currentStock: 450,
    channels: [],
    shopifyLocation: '',
    status: 'Active',
    isPickup: false,
  },
];
