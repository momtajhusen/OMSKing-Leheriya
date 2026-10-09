import api from './api';

export function isChannelManaged(order) {
  return order?.channel === 'Myntra' && ['channel_api', 'channel_push'].includes(order?.source);
}

export function packetIdOf(order) {
  return (order?.channelLines || []).find((line) => line.packetId)?.packetId || '';
}

/** Opens Myntra's own shipping label or tax invoice PDF for the order's packet. */
export async function openMyntraDocument(order, type) {
  const packetId = packetIdOf(order);
  if (!packetId) throw new Error('Myntra has not created a packet for this order yet');
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/integrations/myntra/packets/${encodeURIComponent(packetId)}/${type}`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (win) win.close();
    let message = `Could not open the Myntra ${type}`;
    if (err?.response?.data instanceof Blob) {
      try {
        message = JSON.parse(await err.response.data.text())?.message || message;
      } catch { /* keep default */ }
    }
    throw new Error(message);
  }
}

const DONE = new Set(['success', 'failed', 'partial_success', 'cancelled']);

/** Queues a live Myntra order pull and waits for the worker to finish it. */
export async function pullMyntraOrders({ timeoutMs = 120_000 } = {}) {
  const { data } = await api.post('/integrations/myntra/orders/pull', {});
  const jobId = data?.data?.id;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const res = await api.get('/integrations/jobs');
    const job = (res.data?.data || []).find((row) => row.id === jobId);
    if (job && DONE.has(job.status)) return job;
    if (job?.status === 'queued' && job.lastError) return job;
  }
  return { status: 'running', shortSummary: 'Still running. Refresh in a minute.' };
}
