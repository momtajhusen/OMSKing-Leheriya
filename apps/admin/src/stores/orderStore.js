import { create } from 'zustand';
import api, { apiError } from '../lib/api';
import { withSubOrders, findOrderMatch } from '../lib/orderSubOrders';
import { openPrintHtml } from '../lib/orderPrint';
import useReturnsStore from './returnsStore';

function hydrate(list) {
  return (list || []).map((order) => withSubOrders(order));
}

function stripHtml(data) {
  const { labelHtml: _label, invoiceHtml: _invoice, reverseLabelHtml: _reverse, ...rest } = data || {};
  return rest;
}

if (typeof localStorage !== 'undefined') localStorage.removeItem('omsking-order-desk');

const useOrderStore = create((set, get) => ({
  orders: [],
  loaded: false,
  error: '',

  getById: (id) => findOrderMatch(get().orders, id),

  /** Replace one order with the server copy. */
  putOrder: (dto) => {
    const next = withSubOrders(stripHtml(dto));
    const exists = get().orders.some((order) => order.id === next.id);
    set({
      orders: exists
        ? get().orders.map((order) => (order.id === next.id ? next : order))
        : [next, ...get().orders],
    });
    return next;
  },

  setStatus: async (id, status) => {
    const current = findOrderMatch(get().orders, id);
    if (!current) return { error: 'Order not found' };
    try {
      const { data } = await api.patch(`/orders/${encodeURIComponent(current.id)}/status`, { status });
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not update status') };
    }
  },

  assignSubOrder: async (masterId, subOrderId, payload) => {
    try {
      const { data } = await api.patch(
        `/orders/${encodeURIComponent(masterId)}/sub-orders/${encodeURIComponent(subOrderId)}`,
        { assignedVendor: payload.assignedVendor, price: payload.price },
      );
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not assign vendor') };
    }
  },

  vendorUpdate: async (masterId, subOrderId, body) => {
    try {
      const { data } = await api.patch(
        `/orders/${encodeURIComponent(masterId)}/sub-orders/${encodeURIComponent(subOrderId)}/vendor`,
        body,
      );
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not update line') };
    }
  },

  cancelLabel: async (id) => {
    const current = findOrderMatch(get().orders, id);
    if (!current) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(current.id)}/label/cancel`);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not cancel the label') };
    }
  },

  generateLabel: async (id, subOrderId, extra = {}) => {
    const current = findOrderMatch(get().orders, id);
    if (!current) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(current.id)}/label`, { ...extra, ...(subOrderId ? { subOrderId } : {}) });
      openPrintHtml(data.data.labelHtml);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not generate label') };
    }
  },

  generateInvoice: async (id) => {
    const current = findOrderMatch(get().orders, id);
    if (!current) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(current.id)}/invoice`);
      openPrintHtml(data.data.invoiceHtml);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not generate invoice') };
    }
  },

  markDelivered: (id) => get().setStatus(id, 'Delivered'),

  bookReversePickup: async (id, { reason, courier, awb } = {}) => {
    const current = findOrderMatch(get().orders, id);
    if (!current) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(current.id)}/reverse`, { reason, courier, awb });
      openPrintHtml(data.data.reverseLabelHtml);
      const next = get().putOrder(data.data);
      useReturnsStore.getState().syncFromOrders(get().orders);
      return next;
    } catch (err) {
      return { error: apiError(err, 'Could not book reverse pickup') };
    }
  },

  hydrateFromApi: async () => {
    try {
      const { data } = await api.get('/orders');
      const rows = hydrate(data.data || []);
      set({ orders: rows, loaded: true, error: '' });
      useReturnsStore.getState().syncFromOrders(rows);
    } catch (err) {
      set({ loaded: true, error: apiError(err, 'Could not load orders') });
    }
    return get().orders;
  },
}));

export default useOrderStore;
