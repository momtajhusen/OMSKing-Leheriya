const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const QUEUE_NAME = 'omsking-integrations';

let queue = null;
let worker = null;
let queueConn = null;
let workerConn = null;

function bullEnabled() {
  return Boolean(queue);
}

function attachError(conn) {
  conn.on('error', (err) => {
    console.error('[JOBS]', err.message);
  });
  return conn;
}

function makeConn(url) {
  return attachError(new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 2000,
  }));
}

async function redisReachable(url) {
  const probe = new IORedis(url, {
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

/**
 * Redis is the Phase 1 queue. The Mongo integration_jobs row stays the status record.
 * handler receives the integration job id.
 */
async function startBullTransport(url, handler) {
  if (queue) return true;
  if (!(await redisReachable(url))) return false;
  queueConn = makeConn(url);
  workerConn = makeConn(url);
  queue = new Queue(QUEUE_NAME, { connection: queueConn });
  worker = new Worker(
    QUEUE_NAME,
    async (bullJob) => {
      await handler(bullJob.data.integrationJobId);
    },
    { connection: workerConn, concurrency: 2 },
  );
  worker.on('error', (err) => console.error('[JOBS]', err.message));
  queue.on('error', (err) => console.error('[JOBS]', err.message));
  return true;
}

async function scheduleBull(row, delayMs = 0) {
  if (!queue || !row?._id) return;
  const jobId = `${row._id}:${row.retriesCount || 0}:${Date.now()}`;
  try {
    await queue.add(
      row.jobType || 'manual',
      { integrationJobId: String(row._id) },
      {
        jobId,
        delay: Math.max(0, Number(delayMs) || 0),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  } catch (err) {
    const msg = String(err?.message || '');
    if (!/already exists|JobId|duplicate/i.test(msg)) console.error('[JOBS]', msg);
  }
}

async function stopBullTransport() {
  if (worker) await worker.close();
  if (queue) await queue.close();
  if (queueConn) queueConn.disconnect();
  if (workerConn) workerConn.disconnect();
  worker = null;
  queue = null;
  queueConn = null;
  workerConn = null;
}

module.exports = {
  QUEUE_NAME,
  bullEnabled,
  startBullTransport,
  scheduleBull,
  stopBullTransport,
};
