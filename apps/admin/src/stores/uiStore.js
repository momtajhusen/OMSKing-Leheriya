import { create } from 'zustand';

const useUIStore = create((set) => ({
  sidebarCollapsed: false,
  activeRole: 'super_admin',
  mobileOpen: false,
  breadcrumbs: [],

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  
  setActiveRole: (role) => set({ activeRole: role }),
  
  setMobileOpen: (open) => set({ mobileOpen: open }),
  
  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
}));

export default useUIStore;