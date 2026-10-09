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

const useReturnsStore = create(persist((set, get) => ({
  returns: [],
  workflow: {},

  /** Returns are the reverse pickups on orders; only workflow fields (approve / receive) are kept locally. */
  syncFromOrders: (orders) => {
    const { workflow } = get();
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
    set({ returns: rows });
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
    set({
      returns: get().returns.map((row) => (row.id === id ? withDefaults({ ...row, ...patch }) : row)),
      workflow: { ...get().workflow, [id]: { ...get().workflow[id], ...saved } },
    });
  },

  /** Local workflow state for rows that are not reverse pickups (e.g. RTO QC). */
  setWorkflow: (id, patch) => {
    set({ workflow: { ...get().workflow, [id]: { ...get().workflow[id], ...patch } } });
  },

  approveReturn: async (id, destination = 'All') => {
    const row = get().returns.find((item) => item.id === id);
    if (!row) return null;
    let restockedTo = null;
    if (destination !== 'None') {
      try {
        const { data } = await api.post('/returns/approve-restock', {
          returnId: id,
          referenceId: id,
          items: (row.items || []).map((item) => ({ sku: item.sku, qty: item.qty || 1 })),
          reason: `Return ${id} approved`,
        });
        restockedTo = data.data || null;
      } catch (err) {
        return { error: apiError(err, 'Restock failed') };
      }
    }
    const next = {
      ...row,
      status: 'Approved',
      restockDestination: destination,
      restockedTo,
    };
    get().patchReturn(id, next);
    return next;
  },

  rejectReturn: (id) => {
    get().patchReturn(id, { status: 'Rejected' });
  },

  markReceived: (id, { warehouse, action } = {}) => {
    get().patchReturn(id, {
      status: 'Completed',
      receivedWarehouse: warehouse,
      receiveAction: action,
    });
  },
}), {
  name: 'omsking-returns-desk',
  version: 2,
  partialize: (state) => ({ workflow: state.workflow }),
  migrate: () => ({ workflow: {} }),
}));

export default useReturnsStore;
