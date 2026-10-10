/** Couriers OMSKing can ship on, without the merchant's own API keys. */
const PLATFORM = [
  {
    code: 'delhivery-surface',
    name: 'Delhivery Surface',
    mode: 'surface',
    weightLabel: '0.5kg',
    rateHalfKg: 85,
    serviceability: 'All-India (excl. NE remote)',
    defaultStatus: 'active',
    priority: 1,
  },
  {
    code: 'delhivery-express',
    name: 'Delhivery Express',
    mode: 'air',
    weightLabel: '0.5kg',
    rateHalfKg: 110,
    serviceability: 'Metro + tier 1',
    defaultStatus: 'inactive',
    priority: 5,
  },
  {
    code: 'bluedart',
    name: 'Bluedart',
    mode: 'air',
    weightLabel: '0.5kg',
    rateHalfKg: 120,
    serviceability: 'Metro + tier 1',
    defaultStatus: 'active',
    priority: 2,
  },
  {
    code: 'ecom-express',
    name: 'Ecom Express',
    mode: 'surface',
    weightLabel: '0.5kg',
    rateHalfKg: 95,
    serviceability: 'All-India',
    defaultStatus: 'active',
    priority: 3,
  },
  {
    code: 'xpressbees',
    name: 'Xpressbees',
    mode: 'surface',
    weightLabel: '0.5kg',
    rateHalfKg: 78,
    serviceability: 'Paused',
    defaultStatus: 'inactive',
    priority: 4,
  },
  {
    code: 'amazon-shipping',
    name: 'Amazon Shipping',
    mode: 'surface',
    weightLabel: '1kg',
    rateHalfKg: 90,
    serviceability: 'Amazon serviceable pincodes',
    defaultStatus: 'inactive',
    priority: 6,
  },
];

/** Direct accounts. Merchant pastes their own courier API credentials. */
const OWN = [
  {
    code: 'delhivery',
    name: 'Delhivery',
    capabilities: ['forward', 'ndr'],
    blurb: 'API token and the pickup warehouse name from the Delhivery seller account.',
    fields: [
      { key: 'apiMode', label: 'API environment', type: 'text', required: false, placeholder: 'live' },
      { key: 'apiToken', label: 'API token', type: 'password', required: true, placeholder: 'Token from Delhivery One' },
      { key: 'clientName', label: 'Client name', type: 'text', required: true, placeholder: 'Registered client name' },
      { key: 'pickupWarehouse', label: 'Pickup warehouse name', type: 'text', required: true, placeholder: 'Name on the Delhivery account' },
    ],
  },
  {
    code: 'bluedart',
    name: 'Bluedart',
    capabilities: ['forward', 'return', 'ndr'],
    blurb: 'Login ID, licence key, and customer code from the Bluedart developer profile.',
    fields: [
      { key: 'loginId', label: 'Login ID', type: 'text', required: true, placeholder: 'Bluedart login ID' },
      { key: 'licenceKey', label: 'Licence key', type: 'password', required: true, placeholder: 'Licence key' },
      { key: 'customerCode', label: 'Customer code', type: 'text', required: true, placeholder: 'Customer code' },
    ],
  },
  {
    code: 'ecom-express',
    name: 'Ecom Express',
    capabilities: ['forward', 'ndr'],
    blurb: 'Username and password issued for the Ecom Express API.',
    fields: [
      { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'API username' },
      { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'API password' },
    ],
  },
  {
    code: 'xpressbees',
    name: 'Xpressbees',
    capabilities: ['forward', 'return', 'ndr'],
    blurb: 'Username, password, and secret key from the Xpressbees account.',
    fields: [
      { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'Account email or username' },
      { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'Account password' },
      { key: 'secretKey', label: 'Secret key', type: 'password', required: true, placeholder: 'XB secret key' },
    ],
  },
  {
    code: 'dtdc',
    name: 'DTDC',
    capabilities: ['forward', 'return'],
    blurb: 'Customer code and API key from the DTDC business account.',
    fields: [
      { key: 'customerCode', label: 'Customer code', type: 'text', required: true, placeholder: 'DTDC customer code' },
      { key: 'apiKey', label: 'API key', type: 'password', required: true, placeholder: 'API key' },
    ],
  },
  {
    code: 'shadowfax',
    name: 'Shadowfax',
    capabilities: ['forward'],
    blurb: 'API token from the Shadowfax seller account.',
    fields: [
      { key: 'apiToken', label: 'API token', type: 'password', required: true, placeholder: 'Shadowfax token' },
    ],
  },
  {
    code: 'amazon-shipping',
    name: 'Amazon Shipping',
    capabilities: ['forward'],
    blurb: 'Use this only for the store’s own Amazon Shipping account, not the OMSKing account.',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'LWA client id' },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true, placeholder: 'LWA client secret' },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true, placeholder: 'Refresh token' },
    ],
  },
];

const CUSTOM_FIELDS = [
  { key: 'apiBaseUrl', label: 'API base URL', type: 'text', required: true, placeholder: 'https://' },
  { key: 'apiToken', label: 'API token', type: 'password', required: true, placeholder: 'Token or key' },
  { key: 'pickupWarehouse', label: 'Pickup warehouse name', type: 'text', required: false, placeholder: 'Optional' },
];

const SECRET_KEYS = new Set([
  'apiToken', 'token', 'password', 'licenceKey', 'apiKey', 'secretKey', 'clientSecret', 'refreshToken',
]);

function findPlatform(code) {
  return PLATFORM.find((item) => item.code === code) || null;
}

function findOwn(code) {
  return OWN.find((item) => item.code === code) || null;
}

module.exports = {
  PLATFORM,
  OWN,
  CUSTOM_FIELDS,
  SECRET_KEYS,
  findPlatform,
  findOwn,
};
