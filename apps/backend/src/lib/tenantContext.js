const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function requestContext(req, res, next) {
  const store = {
    tenantId: null,
    skipTenantFilter: true,
    userId: null,
  };
  als.run(store, () => {
    req.ctx = store;
    next();
  });
}

function getTenantContext() {
  return als.getStore() || null;
}

module.exports = { als, requestContext, getTenantContext };
