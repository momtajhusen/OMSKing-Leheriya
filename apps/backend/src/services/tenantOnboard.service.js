const { hashPassword } = require('../lib/password');
const { ROLE_DEFAULT_PERMISSIONS, TENANT_ROLE_SEED } = require('../constants/permissions');
const Tenant = require('../models/Tenant');
const Role = require('../models/Role');
const User = require('../models/User');
const { HttpError } = require('../utils/httpError');

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `tenant-${Date.now()}`;
}

async function cloneTenantRoles(tenantId) {
  const docs = TENANT_ROLE_SEED.map((item) => ({
    tenantId,
    code: item.code,
    name: item.name,
    description: item.description,
    permissions: [...(ROLE_DEFAULT_PERMISSIONS[item.code] || [])],
    isSystem: true,
  }));
  await Role.insertMany(docs);
  return Role.find({ tenantId }).setOptions({ skipTenantFilter: true });
}

async function provisionMerchant({
  name,
  slug,
  ownerEmail,
  ownerName,
  password,
  plan = 'growth',
  status = 'trial',
  channels = [],
}) {
  const finalSlug = slugify(slug || name);
  const exists = await Tenant.findOne({ slug: finalSlug });
  if (exists) throw new HttpError(409, 'A tenant with this slug already exists');

  const tenant = await Tenant.create({
    name,
    slug: finalSlug,
    kind: 'merchant',
    status,
    plan,
    planExpiresAt: status === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : undefined,
    legalEntity: { email: ownerEmail },
    settings: { channels, skuPrefix: (finalSlug || 'OMS').slice(0, 4).toUpperCase() },
  });

  const roles = await cloneTenantRoles(tenant._id);
  const superRole = roles.find((r) => r.code === 'super_admin');
  const passwordHash = await hashPassword(password);
  const owner = await User.create({
    tenantId: tenant._id,
    fullName: ownerName,
    email: ownerEmail.toLowerCase(),
    passwordHash,
    roleId: superRole._id,
    status: 'active',
  });

  const { ensureDefaultWarehouses } = require('./warehouse.service');
  await ensureDefaultWarehouses(tenant._id);

  return { tenant, owner, roles };
}

module.exports = { slugify, cloneTenantRoles, provisionMerchant, ROLE_DEFAULT_PERMISSIONS };
