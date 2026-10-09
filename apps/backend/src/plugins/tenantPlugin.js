const mongoose = require('mongoose');
const { getTenantContext } = require('../lib/tenantContext');

function tenantError(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

function tenantIdValue(raw) {
  if (raw && typeof raw === 'object' && raw._bsontype === 'ObjectId') return raw;
  if (mongoose.Types.ObjectId.isValid(raw)) return new mongoose.Types.ObjectId(String(raw));
  return raw;
}

/**
 * Merchant requests (context present, not skipped) always get tenantId injected.
 * Query-level skipTenantFilter is not an escape hatch in that case — forgetting
 * tenantId in the filter must not read another merchant. Seeds and platform-admin
 * requests have no merchant context, so they keep the explicit filter they pass.
 */
function resolveTenant(opts) {
  if (opts && opts.allowCrossTenant) return { skip: true };
  const ctx = getTenantContext();
  if (!ctx || ctx.skipTenantFilter) return { skip: true };
  if (!ctx.tenantId) throw tenantError('Tenant context is required');
  return { skip: false, tenantId: ctx.tenantId };
}

function tenantPlugin(schema) {
  const filterQuery = function tenantQueryFilter(next) {
    try {
      const decision = resolveTenant(this.getOptions && this.getOptions());
      if (!decision.skip) this.where({ tenantId: decision.tenantId });
      next();
    } catch (err) {
      next(err);
    }
  };

  schema.pre('find', filterQuery);
  schema.pre('findOne', filterQuery);
  schema.pre('findOneAndUpdate', filterQuery);
  schema.pre('countDocuments', filterQuery);
  schema.pre('updateMany', filterQuery);
  schema.pre('updateOne', filterQuery);
  schema.pre('deleteMany', filterQuery);
  schema.pre('deleteOne', filterQuery);

  schema.pre('aggregate', function tenantAggregate(next) {
    try {
      const decision = resolveTenant(this.options);
      if (!decision.skip) {
        this.pipeline().unshift({ $match: { tenantId: tenantIdValue(decision.tenantId) } });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  schema.pre('save', function tenantSave(next) {
    if (!this.isNew) return next();
    try {
      const decision = resolveTenant(this.$__.saveOptions);
      if (decision.skip) return next();
      if (this.tenantId && String(this.tenantId) !== String(decision.tenantId)) {
        return next(tenantError('Cross-tenant write blocked'));
      }
      this.tenantId = decision.tenantId;
      return next();
    } catch (err) {
      return next(err);
    }
  });
}

module.exports = { tenantPlugin, resolveTenant };
