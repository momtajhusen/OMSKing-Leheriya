import { create } from 'zustand';
import api, { apiError } from '../lib/api';
import { withSubOrders, findOrderMatch } from '../lib/orderSubOrders';
import { openPrintHtml, openPdfBase64 } from '../lib/orderPrint';
import useReturnsStore from './returnsStore';

function hydrate(list) {
  return (list || []).map((order) => withSubOrders(order));
}

function stripHtml(data) {
  const { labelHtml: _label, invoiceHtml: _invoice, reverseLabelHtml: _reverse, invoicePdf: _pdf, invoiceEmail: _mail, ...rest } = data || {};
  return rest;
}

if (typeof localStorage !== 'undefined') localStorage.removeItem('omsking-order-desk');

const useOrderStore = create((set, get) => ({
  orders: [],
  loaded: false,
  error: '',

  getById: (id) => findOrderMatch(get().orders, id),

  orderId: (id) => findOrderMatch(get().orders, id)?.id || id,

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
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.patch(`/orders/${encodeURIComponent(orderId)}/status`, { status });
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
      return { ...get().putOrder(data.data), telegram: data.meta?.telegram || '' };
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
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(orderId)}/label/cancel`);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not cancel the label') };
    }
  },

  shipOnMarketplace: async (id) => {
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(orderId)}/ship`);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not ship on the marketplace') };
    }
  },

  queueLabelJob: async (orderIds) => {
    try {
      const { data } = await api.post('/orders/labels/bulk', { orderIds });
      return data.data;
    } catch (err) {
      return { error: apiError(err, 'Could not queue the label job') };
    }
  },

  closeManifest: async () => {
    try {
      const { data } = await api.post('/orders/manifest');
      return data.data;
    } catch (err) {
      return { error: apiError(err, 'Could not request today\'s pickup') };
    }
  },

  generateLabel: async (id, subOrderId, extra = {}) => {
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(orderId)}/label`, { ...extra, ...(subOrderId ? { subOrderId } : {}) });
      openPrintHtml(data.data.labelHtml);
      return get().putOrder(data.data);
    } catch (err) {
      return { error: apiError(err, 'Could not generate label') };
    }
  },

  generateInvoice: async (id, { kind = 'invoice', email = true, preview = true } = {}) => {
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(orderId)}/invoice`, { kind, email });
      const pdf = data.data?.invoicePdf;
      const number = kind === 'credit'
        ? `CN-${data.data?.invoiceNo || orderId}`
        : (data.data?.invoiceNo || orderId);
      if (preview && pdf) openPdfBase64(pdf, `${number}.pdf`);
      else if (preview && data.data?.invoiceHtml) openPrintHtml(data.data.invoiceHtml);
      return { ...get().putOrder(data.data), invoicePdf: pdf, invoiceEmail: data.data?.invoiceEmail };
    } catch (err) {
      return { error: apiError(err, 'Could not generate invoice') };
    }
  },

  markDelivered: (id) => get().setStatus(id, 'Delivered'),

  bookReversePickup: async (id, { reason, courier, awb } = {}) => {
    const orderId = get().orderId(id);
    if (!orderId) return { error: 'Order not found' };
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(orderId)}/reverse`, { reason, courier, awb });
      openPrintHtml(data.data.reverseLabelHtml);
      const next = get().putOrder(data.data);
      useReturnsStore.getState().syncFromOrders(get().orders);
      return next;
    } catch (err) {
      return { error: apiError(err, 'Could not book reverse pickup') };
    }
  },

  clearCompany() {
    set({ orders: [], loaded: false, error: '' });
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
