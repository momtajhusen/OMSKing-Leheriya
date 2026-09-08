export const CHANNEL_CATALOG = [
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Leheriya storefront — orders, inventory, fulfilments. GST invoice number = Order ID.',
    fields: [
      { key: 'shopUrl', label: 'Shop URL', placeholder: 'leheriya.myshopify.com', type: 'text' },
      { key: 'adminToken', label: 'Admin API token', placeholder: 'shpat_…', type: 'password' },
      { key: 'apiSecret', label: 'API secret', placeholder: 'shpss_…', type: 'password' },
      { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'whsec_…', type: 'password' },
    ],
  },
  {
    id: 'amazon',
    name: 'Amazon',
    description: 'Seller Central SP-API — orders, inventory, settlements',
    fields: [
      { key: 'sellerId', label: 'Seller ID', placeholder: 'A2XXXXXXX', type: 'text' },
      { key: 'marketplaceId', label: 'Marketplace ID', placeholder: 'A21TJRUUN4KGV', type: 'text' },
      { key: 'lwaClientId', label: 'LWA Client ID', placeholder: 'amzn1.application-oa2-client…', type: 'text' },
      { key: 'lwaClientSecret', label: 'LWA Client Secret', placeholder: '••••••••', type: 'password' },
      { key: 'refreshToken', label: 'Refresh token', placeholder: 'Atzr|…', type: 'password' },
    ],
  },
  {
    id: 'flipkart',
    name: 'Flipkart',
    description: 'Not in Leheriya launch. Can be added later per tenant.',
    fields: [
      { key: 'sellerId', label: 'Seller ID', placeholder: 'FK…', type: 'text' },
      { key: 'apiToken', label: 'API token', placeholder: '••••••••', type: 'password' },
    ],
  },
  {
    id: 'meesho',
    name: 'Meesho',
    description: 'Not in Leheriya launch. Can be added later per tenant.',
    fields: [
      { key: 'supplierId', label: 'Supplier ID', placeholder: 'MSH…', type: 'text' },
      { key: 'apiToken', label: 'API token', placeholder: '••••••••', type: 'password' },
    ],
  },
  {
    id: 'myntra',
    name: 'Myntra',
    description: 'Partner API — orders, inventory, their courier labels',
    fields: [
      { key: 'partnerId', label: 'Partner ID', placeholder: 'MNP…', type: 'text' },
      { key: 'apiToken', label: 'API token', placeholder: '••••••••', type: 'password' },
      { key: 'warehouseCode', label: 'Pickup warehouse code', placeholder: 'WH-001', type: 'text' },
    ],
  },
  {
    id: 'ajio',
    name: 'AJIO',
    description: 'Not in Leheriya launch. Can be added later per tenant.',
    fields: [
      { key: 'vendorCode', label: 'Vendor code', placeholder: 'AJ…', type: 'text' },
      { key: 'apiToken', label: 'API token', placeholder: '••••••••', type: 'password' },
    ],
  },
  {
    id: 'nykaa',
    name: 'Nykaa',
    description: 'Not in Leheriya launch. Can be added later per tenant.',
    fields: [
      { key: 'partnerId', label: 'Partner ID', placeholder: 'NYK…', type: 'text' },
      { key: 'apiToken', label: 'API token', placeholder: '••••••••', type: 'password' },
    ],
  },
];

export const SUBSCRIPTION_PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '₹2,999 / month',
    channelLimit: 1,
    features: ['1 of Shopify / Amazon / Myntra', 'Orders + inventory', 'GST invoice'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '₹7,999 / month',
    channelLimit: 3,
    features: ['Shopify + Amazon + Myntra', 'Vendor portal', 'Settlement matching'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    channelLimit: null,
    features: ['Unlimited channels', 'All modules', 'Priority support'],
  },
];
