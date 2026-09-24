import { create } from 'zustand';
import { ROLES } from '../constants/roles';
import { attachPermissions } from '../constants/permissions';
import useUIStore from './uiStore';
import api from '../lib/api';

const STORAGE_USER = 'user';
const STORAGE_TOKEN = 'token';

function readUser() {
  try {
    const token = localStorage.getItem(STORAGE_TOKEN);
    const raw = localStorage.getItem(STORAGE_USER);
    if (!token || !raw) return null;
    return attachPermissions(JSON.parse(raw));
  } catch {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    return null;
  }
}

const stored = typeof localStorage === 'undefined' ? null : readUser();

const useAuthStore = create((set, get) => ({
  isAuthenticated: Boolean(stored),
  user: stored,
  loading: Boolean(stored),

  persist: (token, userData) => {
    const next = attachPermissions(userData);
    localStorage.setItem(STORAGE_TOKEN, token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(next));
    set({ isAuthenticated: true, user: next, loading: false });
    useUIStore.getState().setActiveRole(next.impersonating ? ROLES.SUPER_ADMIN : next.role);
  },

  login: (token, userData) => {
    get().persist(token, userData);
  },

  logoutLocal: () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    set({ isAuthenticated: false, user: null, loading: false });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* cookie already gone */
    }
    get().logoutLocal();
  },

  hydrate: async () => {
    const token = localStorage.getItem(STORAGE_TOKEN);
    if (!token) {
      set({ loading: false, isAuthenticated: false, user: null });
      return;
    }
    set({ loading: true });
    try {
      const { data } = await api.get('/auth/me');
      get().persist(token, data.data);
    } catch {
      try {
        const { data } = await api.post('/auth/refresh');
        get().persist(data.data.accessToken, data.data.user);
      } catch {
        get().logoutLocal();
      }
    }
  },

  impersonateTenant: async (tenant) => {
    const { data } = await api.post(`/tenants/${tenant.id}/impersonate`);
    get().persist(data.data.accessToken, data.data.user);
  },

  exitImpersonation: async () => {
    const { data } = await api.post('/auth/exit-impersonation');
    get().persist(data.data.accessToken, data.data.user);
  },
}));

export default useAuthStore;
