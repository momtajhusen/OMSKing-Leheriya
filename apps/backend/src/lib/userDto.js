function publicUser(user, tenant, extras = {}) {
  const role = extras.roleCode || user.roleId?.code;
  const permissions = extras.permissions || user.roleId?.permissions || [];
  const tenantId = extras.tenantId !== undefined
    ? extras.tenantId
    : (user.tenantId?._id || user.tenantId);
  return {
    id: String(user._id),
    email: user.email,
    name: user.fullName,
    role,
    permissions,
    tenantId: tenantId ? String(tenantId) : null,
    tenantName: extras.tenantName || tenant?.name || user.tenantId?.name || null,
    plan: extras.plan || tenant?.plan || user.tenantId?.plan || null,
    tenantStatus: extras.tenantStatus || tenant?.status || user.tenantId?.status || null,
    planExpiresAt: extras.planExpiresAt || tenant?.planExpiresAt || user.tenantId?.planExpiresAt || null,
    impersonating: Boolean(extras.impersonating),
    assignedVendorIds: (user.assignedVendorIds || []).map(String),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    avatarUrl: user.avatarUrl || '',
    status: user.status,
    lastLoginAt: user.lastLoginAt,
  };
}

function accessPayload(userDto, extra = {}) {
  return {
    sub: userDto.id,
    role: userDto.role,
    permissions: userDto.permissions,
    tenantId: userDto.tenantId,
    impersonating: userDto.impersonating,
    rv: extra.rv ?? 0,
  };
}

module.exports = { publicUser, accessPayload };
