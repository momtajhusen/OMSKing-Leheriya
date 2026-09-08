import { create } from 'zustand';
import { ROLES } from '../constants/roles';
import { attachPermissions } from '../constants/permissions';
import useUIStore from './uiStore';

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

function snapshotPlatformUser(user) {
  if (user?.platformUser) return user.platformUser;
  return {
    email: user.email,
    name: user.name,
    role: ROLES.PLATFORM_ADMIN,
    tenantId: null,
    tenantName: 'OMSKing SaaS',
  };
}

const stored = typeof localStorage === 'undefined' ? null : readUser();

const useAuthStore = create((set, get) => ({
  isAuthenticated: Boolean(stored),
  user: stored,
  loading: false,

  persist: (token, userData) => {
    const next = attachPermissions(userData);
    localStorage.setItem(STORAGE_TOKEN, token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(next));
    set({ isAuthenticated: true, user: next });
    useUIStore.getState().setActiveRole(next.impersonating ? ROLES.SUPER_ADMIN : next.role);
  },

  login: (token, userData) => {
    get().persist(token, userData);
  },

  logout: () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    set({ isAuthenticated: false, user: null });
  },

  impersonateTenant: (tenant) => {
    const { user, persist } = get();
    const canImpersonate = user?.role === ROLES.PLATFORM_ADMIN || user?.platformUser;
    if (!user || !canImpersonate) return;
    const platformUser = snapshotPlatformUser(user);
    persist(`impersonate-${tenant.id}-${Date.now()}`, {
      email: platformUser.email,
      name: platformUser.name,
      role: ROLES.SUPER_ADMIN,
      tenantId: tenant.id,
      tenantName: tenant.name,
      impersonating: true,
      platformUser,
    });
  },

  exitImpersonation: () => {
    const { user, persist } = get();
    if (!user?.platformUser) return;
    persist(`platform-${Date.now()}`, user.platformUser);
  },
}));

export default useAuthStore;
