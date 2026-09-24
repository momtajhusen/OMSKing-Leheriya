const { getTenantContext } = require('../lib/tenantContext');

function tenantPlugin(schema) {
  const filter = function tenantQueryFilter() {
    if (this.getOptions && this.getOptions().skipTenantFilter) return;
    const ctx = getTenantContext();
    if (!ctx || ctx.skipTenantFilter) return;
    if (!ctx.tenantId) {
      this.where({ _id: null });
      return;
    }
    this.where({ tenantId: ctx.tenantId });
  };

  schema.pre('find', filter);
  schema.pre('findOne', filter);
  schema.pre('findOneAndUpdate', filter);
  schema.pre('countDocuments', filter);
  schema.pre('updateMany', filter);
  schema.pre('deleteMany', filter);
  schema.pre('deleteOne', filter);

  schema.pre('save', function tenantSave() {
    const ctx = getTenantContext();
    if (!this.isNew || this.tenantId) return;
    if (ctx && !ctx.skipTenantFilter && ctx.tenantId) {
      this.tenantId = ctx.tenantId;
    }
  });
}

module.exports = { tenantPlugin };
