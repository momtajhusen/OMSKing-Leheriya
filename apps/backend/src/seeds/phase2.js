require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config');
const Tenant = require('../models/Tenant');
const Role = require('../models/Role');
const User = require('../models/User');
const { ROLE_DEFAULT_PERMISSIONS } = require('../constants/permissions');
const { provisionMerchant } = require('../services/tenantOnboard.service');
const { seedLeheriyaCatalog } = require('./phase3Catalog');
const { seedLeheriyaChannels } = require('./phase3Channels');
const { seedLeheriyaInventory } = require('./phase4Inventory');

const PASSWORD = 'password123';

async function seed() {
  await mongoose.connect(config.mongodbUri);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  let platform = await Tenant.findOne({ slug: 'omsking-platform' });
  if (!platform) {
    platform = await Tenant.create({
      name: 'OMSKing SaaS',
      slug: 'omsking-platform',
      kind: 'platform',
      status: 'active',
      plan: 'enterprise',
      legalEntity: { email: 'platform@omsking.com' },
    });
  }

  let platformRole = await Role.findOne({ tenantId: platform._id, code: 'platform_admin' }).setOptions({ skipTenantFilter: true });
  if (!platformRole) {
    platformRole = await Role.create({
      tenantId: platform._id,
      code: 'platform_admin',
      name: 'Platform Admin',
      description: 'SaaS owner',
      permissions: [...ROLE_DEFAULT_PERMISSIONS.platform_admin],
      isSystem: true,
    });
  }

  const platformUser = await User.findOne({ email: 'platform@omsking.com' }).setOptions({ skipTenantFilter: true });
  if (!platformUser) {
    await User.create({
      tenantId: platform._id,
      fullName: 'OMSKing Platform',
      email: 'platform@omsking.com',
      passwordHash,
      roleId: platformRole._id,
      status: 'active',
    });
  }

  let leheriya = await Tenant.findOne({ slug: 'leheriya' });
  if (!leheriya) {
    const created = await provisionMerchant({
      name: 'Leheriya Creations',
      slug: 'leheriya',
      ownerEmail: 'superadmin@omsking.com',
      ownerName: 'Leheriya Super Admin',
      password: PASSWORD,
      plan: 'enterprise',
      status: 'active',
      channels: ['Shopify', 'Amazon', 'Myntra'],
    });
    leheriya = created.tenant;
  }
  if (!leheriya.settings) leheriya.settings = {};
  if (!leheriya.settings.skuPrefix) {
    leheriya.settings.skuPrefix = 'LH';
    await leheriya.save();
  }

  async function ensureStaff(email, fullName, code) {
    const existing = await User.findOne({ email }).setOptions({ skipTenantFilter: true });
    if (existing) return;
    const role = await Role.findOne({ tenantId: leheriya._id, code }).setOptions({ skipTenantFilter: true });
    await User.create({
      tenantId: leheriya._id,
      fullName,
      email,
      passwordHash,
      roleId: role._id,
      status: 'active',
    });
  }

  await ensureStaff('ops@leheriya.com', 'Anita Sharma', 'operations');
  await ensureStaff('vendor@omsking.com', 'Sandeep Textiles', 'vendor');

  const surat = await Tenant.findOne({ slug: 'surat-silks' });
  if (!surat) {
    await provisionMerchant({
      name: 'Surat Silks',
      slug: 'surat-silks',
      ownerEmail: 'ravi@suratsilks.com',
      ownerName: 'Ravi Patel',
      password: PASSWORD,
      plan: 'growth',
      status: 'trial',
      channels: ['Shopify'],
    });
  }

  await Role.updateMany(
    { code: { $in: ['super_admin', 'operations'] } },
    { $addToSet: { permissions: 'vendors.manage' } },
  ).setOptions({ skipTenantFilter: true });

  await seedLeheriyaCatalog(leheriya._id);
  await seedLeheriyaChannels(leheriya._id);
  await seedLeheriyaInventory(leheriya._id);
  console.log('[SEED] Channel credentials loaded from .env (Shopify + Amazon + Myntra) — test from /channels');

  console.log('[SEED] Phase 2 accounts (password: password123)');
  console.log('[SEED] Phase 3 Leheriya catalog (Master SKU + mappings)');
  console.log('[SEED] Phase 4 warehouses WH-001 / WH-002 + opening stock');
  console.log('  platform@omsking.com → /platform');
  console.log('  superadmin@omsking.com → /dashboard (Leheriya)');
  console.log('  ops@leheriya.com → /dashboard');
  console.log('  vendor@omsking.com → /vendor/orders');
  console.log('  ravi@suratsilks.com → /dashboard (Surat Silks isolation)');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
