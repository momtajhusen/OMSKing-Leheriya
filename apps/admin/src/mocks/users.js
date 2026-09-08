import { ROLES } from '../constants/roles';

export const users = [
  { id: 'USR-001', name: 'Momtaj Husen', email: 'superadmin@omsking.com', role: ROLES.SUPER_ADMIN, status: 'Active', lastLogin: '2026-09-08 10:30 AM', createdAt: '2026-01-15' },
  { id: 'USR-002', name: 'Sandeep Textiles', email: 'vendor@omsking.com', role: ROLES.VENDOR, status: 'Active', lastLogin: '2026-09-08 09:15 AM', createdAt: '2026-02-20' },
  { id: 'USR-003', name: 'Rajshree Fabrics', email: 'rajshree@fabrics.com', role: ROLES.VENDOR, status: 'Active', lastLogin: '2026-09-07 04:45 PM', createdAt: '2026-03-10' },
  { id: 'USR-004', name: 'Anita Sharma', email: 'ops@leheriya.com', role: ROLES.OPERATIONS, status: 'Active', lastLogin: '2026-09-08 08:00 AM', createdAt: '2026-04-05' },
  { id: 'USR-005', name: 'Vikram Singh', email: 'vikram@warehouse.leheriya.com', role: ROLES.WAREHOUSE, status: 'Active', lastLogin: '2026-09-07 11:30 AM', createdAt: '2026-05-12' },
  { id: 'USR-006', name: 'Priya Kumar', email: 'priya@accounts.leheriya.com', role: ROLES.ACCOUNTS, status: 'Active', lastLogin: '2026-09-08 07:45 AM', createdAt: '2026-06-18' },
  { id: 'USR-007', name: 'Manoj Agarwal', email: 'manoj@fabrics.com', role: ROLES.VENDOR, status: 'Active', lastLogin: '2026-09-06 03:20 PM', createdAt: '2026-07-22' },
  { id: 'USR-008', name: 'Neha Catalog', email: 'neha@catalog.leheriya.com', role: ROLES.CATALOG_MANAGER, status: 'Active', lastLogin: '2026-09-07 10:00 AM', createdAt: '2026-08-01' },
  { id: 'USR-009', name: 'Rajesh Patel', email: 'rajesh@operations.com', role: ROLES.OPERATIONS, status: 'Inactive', lastLogin: '2026-08-15 02:30 PM', createdAt: '2026-02-28' },
  { id: 'USR-010', name: 'Kavita Joshi', email: 'kavita@support.leheriya.com', role: ROLES.CUSTOMER_SUPPORT, status: 'Active', lastLogin: '2026-09-08 09:00 AM', createdAt: '2026-09-01' },
];
