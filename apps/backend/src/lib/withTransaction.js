const mongoose = require('mongoose');
const config = require('../config');

const MAX_TX_ATTEMPTS = 3;
const STANDALONE_MESSAGE = '[DB] MongoDB is not a replica set or Atlas. Inventory stock and ledger cannot commit atomically. Use a replica set or Atlas.';

let cached = null;
let warned = false;

function helloSupportsTransactions(hello) {
  return Boolean(hello?.setName) || hello?.msg === 'isdbgrid';
}

function errorLabelsOf(err) {
  if (!err) return [];
  const labels = [];
  if (typeof err.hasErrorLabel === 'function') {
    if (err.hasErrorLabel('TransientTransactionError')) labels.push('TransientTransactionError');
    if (err.hasErrorLabel('UnknownTransactionCommitResult')) labels.push('UnknownTransactionCommitResult');
  }
  if (Array.isArray(err.errorLabels)) labels.push(...err.errorLabels);
  return labels;
}

function isTransientTransactionError(err) {
  if (!err) return false;
  const labels = errorLabelsOf(err);
  if (labels.includes('TransientTransactionError') || labels.includes('UnknownTransactionCommitResult')) {
    return true;
  }
  return err.code === 112 || err.codeName === 'WriteConflict';
}

function shouldRetryTransaction(err) {
  if (!err || errorLabelsOf(err).includes('UnknownTransactionCommitResult')) return false;
  return isTransientTransactionError(err);
}

function resetReplicaSetCache() {
  cached = null;
  warned = false;
}

async function replicaSetAvailable({ silent = false } = {}) {
  if (cached != null) return cached;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    cached = helloSupportsTransactions(hello);
  } catch {
    cached = false;
  }
  if (!cached && !warned && !silent) {
    warned = true;
    console.warn(STANDALONE_MESSAGE);
  }
  return cached;
}

async function assertTransactionSupport({ env = config.nodeEnv } = {}) {
  const ok = await replicaSetAvailable({ silent: true });
  if (ok) return true;
  warned = true;
  console.error(STANDALONE_MESSAGE);
  if (env === 'production') {
    throw new Error(STANDALONE_MESSAGE);
  }
  return false;
}

async function withTransaction(work) {
  if (!(await replicaSetAvailable())) {
    return work(null);
  }
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TX_ATTEMPTS && shouldRetryTransaction(err)) {
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
  throw lastErr;
}

module.exports = {
  withTransaction,
  replicaSetAvailable,
  assertTransactionSupport,
  helloSupportsTransactions,
  isTransientTransactionError,
  resetReplicaSetCache,
};
