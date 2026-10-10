import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api, { apiError } from '../lib/api';

export function vendorReportLabel(name) {
  const text = String(name ?? '').trim();
  if (!text || /^(null|void|undefined|n\/a|—|-)$/i.test(text)) return 'Unknown vendor';
  return text;
}

function tenantKey() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').tenantId || 'none';
  } catch {
    return 'none';
  }
}

const useVendorStore = create(persist((set, get) => ({
  vendors: [],
  loaded: false,
  error: '',
  autoAssignByTenant: {},

  autoAssignOn() {
    return Boolean(get().autoAssignByTenant[tenantKey()]);
  },

  setAutoAssign: (on) => {
    const key = tenantKey();
    set({ autoAssignByTenant: { ...get().autoAssignByTenant, [key]: Boolean(on) } });
  },

  clearCompany() {
    set({ vendors: [], loaded: false, error: '', autoAssignByTenant: {} });
  },

  load: async () => {
    try {
      const { data } = await api.get('/vendors');
      set({ vendors: data.data || [], loaded: true, error: '' });
    } catch (err) {
      set({ loaded: true, error: apiError(err, 'Could not load vendors') });
    }
    return get().vendors;
  },

  upsertRow: (row) => {
    const rest = get().vendors.filter((vendor) => vendor.id !== row.id);
    set({ vendors: [row, ...rest].sort((a, b) => Number(a.removed) - Number(b.removed) || a.name.localeCompare(b.name)) });
    return row;
  },

  saveVendor: async (payload, id) => {
    const body = {
      name: payload.name,
      location: payload.location || '',
      phone: payload.phone || '',
      email: payload.email || '',
      telegramGroup: payload.telegramGroup || '',
    };
    const { data } = id ? await api.patch(`/vendors/${id}`, body) : await api.post('/vendors', body);
    return get().upsertRow(data.data);
  },

  setStatus: async (id, status) => {
    const { data } = await api.patch(`/vendors/${id}`, { status });
    return get().upsertRow(data.data);
  },

  removeVendor: async (id) => {
    const { data } = await api.delete(`/vendors/${id}`);
    return get().upsertRow(data.data);
  },

  addShopifyVendors: async (names) => {
    const { data } = await api.post('/vendors/import', { names: names || [], source: 'shopify' });
    await get().load();
    return data.data?.added || 0;
  },
}), {
  name: 'omsking-vendor-desk',
  version: 3,
  partialize: (state) => ({ autoAssignByTenant: state.autoAssignByTenant }),
  migrate: () => ({ autoAssignByTenant: {} }),
}));

export default useVendorStore;
