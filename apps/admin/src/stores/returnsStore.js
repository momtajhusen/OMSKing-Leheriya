import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api, { apiError } from '../lib/api';
import { reverseLabelHtml, openPrintHtml } from '../lib/orderPrint';

function withDefaults(row) {
  return {
    type: 'customer_return',
    restockDestination: row.restockDestination || null,
    restockedTo: row.restockedTo || null,
    ...row,
  };
}

const WORKFLOW_KEYS = ['status', 'restockDestination', 'restockedTo', 'receivedWarehouse', 'receiveAction'];
export const EMPTY_WORKFLOW = {};

function tenantKey() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').tenantId || 'none';
  } catch {
    return 'none';
  }
}

const useReturnsStore = create(persist((set, get) => ({
  returns: [],
  workflowByTenant: {},

  workflowNow() {
    return get().workflowByTenant[tenantKey()] || {};
  },

  clearCompany() {
    set({ returns: [] });
  },

  /** Returns are the reverse pickups on orders; only workflow fields (approve / receive) are kept locally. */
  syncFromOrders: (orders) => {
    const workflow = get().workflowNow();
    const apiRows = get().returns.filter((row) => row.source === 'api');
    const rows = [];
    (orders || []).forEach((order) => {
      const pickup = order.reversePickup;
      if (!pickup?.returnId) return;
      const prev = workflow[pickup.returnId] || {};
      rows.push(withDefaults({
        status: 'Approved',
        restockDestination: 'All',
        ...prev,
        id: pickup.returnId,
        orderId: order.id,
        customer: order.customer,
        reason: pickup.reason || 'Reverse pickup',
        type: 'reverse_pickup',
        requestDate: pickup.bookedAt || order.createdAt,
        amount: order.total,
        items: order.items || [],
        courier: pickup.courier || '',
        awb: pickup.awb || '',
        labelGeneratedAt: pickup.bookedAt,
      }));
    });
    rows.sort((x, y) => String(y.requestDate).localeCompare(String(x.requestDate)));
    const localIds = new Set(rows.map((row) => row.id));
    set({ returns: [...apiRows.filter((row) => !localIds.has(row.id)), ...rows] });
  },

  loadReturns: async () => {
    try {
      const { data } = await api.get('/returns');
      const apiRows = (data.data || []).map((row) => withDefaults({ ...row, source: 'api', type: 'customer_return' }));
      const local = get().returns.filter((row) => row.source !== 'api');
      set({ returns: [...apiRows, ...local] });
    } catch (err) {
      return { error: apiError(err, 'Could not load returns') };
    }
    return get().returns;
  },

  printReverseLabel: (row, order) => {
    openPrintHtml(reverseLabelHtml(order || {
      id: row.orderId,
      customer: row.customer,
      items: row.items,
      address: '',
      courier: row.courier,
      reversePickup: row,
    }, row));
  },

  patchReturn: (id, patch) => {
    const saved = Object.fromEntries(WORKFLOW_KEYS.filter((key) => key in patch).map((key) => [key, patch[key]]));
    const key = tenantKey();
    const bucket = get().workflowByTenant[key] || {};
    set({
      returns: get().returns.map((row) => (row.id === id ? withDefaults({ ...row, ...patch }) : row)),
      workflowByTenant: { ...get().workflowByTenant, [key]: { ...bucket, [id]: { ...bucket[id], ...saved } } },
    });
  },

  /** Local workflow state for rows that are not reverse pickups (e.g. RTO QC). */
  setWorkflow: (id, patch) => {
    const key = tenantKey();
    const bucket = get().workflowByTenant[key] || {};
    set({ workflowByTenant: { ...get().workflowByTenant, [key]: { ...bucket, [id]: { ...bucket[id], ...patch } } } });
  },

  approveReturn: async (id, destination = 'All') => {
    const row = get().returns.find((item) => item.id === id);
    if (!row) return null;
    let awb = row.awb;
    if (row.source === 'api') {
      try {
        const { data } = await api.post(`/returns/${encodeURIComponent(id)}/approve`);
        awb = data.data?.awb || awb;
      } catch (err) {
        return { error: apiError(err, 'Could not approve the return') };
      }
    }
    const next = {
      ...row,
      status: 'Approved',
      restockDestination: destination,
      awb,
      labelGeneratedAt: row.labelGeneratedAt || new Date().toISOString(),
    };
    get().patchReturn(id, next);
    return next;
  },

  rejectReturn: (id) => {
    get().patchReturn(id, { status: 'Rejected' });
  },

  markReceived: async (id, { warehouse, action, destination } = {}) => {
    const row = get().returns.find((item) => item.id === id);
    if (!row) return null;
    const dest = destination || row.restockDestination || 'All';
    if (action === 'restock' && dest !== 'None') {
      try {
        if (row.source === 'api') {
          await api.post(`/returns/${encodeURIComponent(id)}/receive`, { destination: dest, action: 'restock' });
        } else {
          await api.post('/returns/approve-restock', {
            returnId: id,
            referenceId: id,
            destination: dest,
            movementType: 'return_restock',
            warehouseCode: warehouse || 'WH-001',
            items: (row.items || []).map((item) => ({ sku: item.sku, qty: item.qty || 1 })),
            reason: `Return ${id} received`,
          });
        }
      } catch (err) {
        return { error: apiError(err, 'Restock failed') };
      }
    }
    get().patchReturn(id, {
      status: 'Completed',
      receivedWarehouse: warehouse,
      receiveAction: action,
      restockDestination: dest,
    });
    return get().returns.find((item) => item.id === id);
  },
}), {
  name: 'omsking-returns-desk',
  version: 3,
  partialize: (state) => ({ workflowByTenant: state.workflowByTenant }),
  migrate: () => ({ workflowByTenant: {} }),
}));

export default useReturnsStore;
