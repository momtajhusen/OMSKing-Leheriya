const mongoose = require('mongoose');

let cached = null;
let warned = false;

async function replicaSetAvailable() {
  if (cached != null) return cached;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    cached = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    cached = false;
  }
  if (!cached && !warned) {
    warned = true;
    console.warn('[DB] MongoDB is not a replica set. Inventory stock and ledger cannot commit atomically. Use a replica set or Atlas.');
  }
  return cached;
}

async function withTransaction(work) {
  if (!(await replicaSetAvailable())) {
    return work(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction, replicaSetAvailable };
