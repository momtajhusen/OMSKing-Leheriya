import { ROLES } from '../constants/roles';

export const DEMO_PASSWORD = 'password123';

export const DEMO_ACCOUNTS = [
  {
    email: 'platform@omsking.com',
    password: DEMO_PASSWORD,
    name: 'OMSKing Platform',
    role: ROLES.PLATFORM_ADMIN,
    tenantId: null,
    tenantName: 'OMSKing SaaS',
  },
  {
    email: 'superadmin@omsking.com',
    password: DEMO_PASSWORD,
    name: 'Momtaj Husen',
    role: ROLES.SUPER_ADMIN,
    tenantId: 'TNT-001',
    tenantName: 'Leheriya Creations',
  },
  {
    email: 'ops@leheriya.com',
    password: DEMO_PASSWORD,
    name: 'Anita Sharma',
    role: ROLES.OPERATIONS,
    tenantId: 'TNT-001',
    tenantName: 'Leheriya Creations',
  },
  {
    email: 'vendor@omsking.com',
    password: DEMO_PASSWORD,
    name: 'Sandeep Textiles',
    role: ROLES.VENDOR,
    tenantId: 'TNT-001',
    tenantName: 'Leheriya Creations',
    vendorId: 'VND-001',
  },
];

export const PLATFORM_TENANTS = [
  {
    id: 'TNT-001',
    name: 'Leheriya Creations',
    owner: 'Momtaj Husen',
    email: 'superadmin@omsking.com',
    status: 'Active',
    plan: 'Enterprise',
    channels: ['Amazon', 'Myntra'],
    users: 8,
    lastSync: '2026-09-08 10:30 AM',
    mrr: 0,
  },
  {
    id: 'TNT-002',
    name: 'Jaipur Craft Co.',
    owner: 'Neha Agarwal',
    email: 'neha@jaipurcraft.com',
    status: 'Trial',
    plan: 'Growth',
    channels: ['Meesho'],
    users: 3,
    lastSync: '2026-09-07 04:15 PM',
    mrr: 7999,
  },
  {
    id: 'TNT-003',
    name: 'Surat Silks',
    owner: 'Ravi Patel',
    email: 'ravi@suratsilks.com',
    status: 'Active',
    plan: 'Starter',
    channels: ['Amazon'],
    users: 2,
    lastSync: '2026-09-08 08:10 AM',
    mrr: 2999,
  },
  {
    id: 'TNT-004',
    name: 'Test Tenant',
    owner: 'Demo',
    email: 'test@omsking.com',
    status: 'Suspended',
    plan: 'Growth',
    channels: [],
    users: 1,
    lastSync: 'Never',
    mrr: 0,
  },
];

export const AUTH_SESSIONS = [
  { id: 'SES-001', user: 'Momtaj Husen', email: 'superadmin@omsking.com', tenant: 'Leheriya Creations', role: 'Super Admin', device: 'Chrome · macOS', ip: '103.21.58.14', startedAt: '2026-09-08 09:12', lastActive: '2 min ago', status: 'Active' },
  { id: 'SES-002', user: 'Anita Sharma', email: 'ops@leheriya.com', tenant: 'Leheriya Creations', role: 'Operations', device: 'Chrome · Windows', ip: '49.36.180.72', startedAt: '2026-09-08 08:40', lastActive: '18 min ago', status: 'Active' },
  { id: 'SES-003', user: 'Sandeep Textiles', email: 'vendor@omsking.com', tenant: 'Leheriya Creations', role: 'Vendor', device: 'Safari · iPhone', ip: '106.51.44.9', startedAt: '2026-09-08 07:55', lastActive: '1 hr ago', status: 'Active' },
  { id: 'SES-004', user: 'OMSKing Platform', email: 'platform@omsking.com', tenant: 'OMSKing SaaS', role: 'Platform Admin', device: 'Chrome · macOS', ip: '103.21.58.14', startedAt: '2026-09-08 07:02', lastActive: '1 min ago', status: 'Active' },
  { id: 'SES-005', user: 'Ravi Patel', email: 'ravi@suratsilks.com', tenant: 'Surat Silks', role: 'Super Admin', device: 'Chrome · Android', ip: '117.99.12.201', startedAt: '2026-09-07 18:20', lastActive: '14 hr ago', status: 'Expired' },
];

export function findDemoAccount(email, password) {
  return DEMO_ACCOUNTS.find(
    (account) => account.email.toLowerCase() === email.toLowerCase() && account.password === password
  );
}
