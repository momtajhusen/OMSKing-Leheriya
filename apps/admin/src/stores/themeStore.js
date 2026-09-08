import { create } from 'zustand';

export const THEME_STORAGE_KEY = 'oms-theme';
export const THEME_DEFAULT_FLAG = 'oms-theme-default';
export const DEFAULT_THEME = 'light';

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  if (document.documentElement.classList.contains('force-light')) return;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/** One-time: old installs stored dark as the product default. Admin now starts light. */
function resolveTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    if (localStorage.getItem(THEME_DEFAULT_FLAG) !== DEFAULT_THEME) {
      localStorage.setItem(THEME_DEFAULT_FLAG, DEFAULT_THEME);
      localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME);
      return DEFAULT_THEME;
    }
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const useThemeStore = create((set) => ({
  theme: resolveTheme(),

  initializeTheme: () => {
    const theme = resolveTheme();
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        localStorage.setItem(THEME_DEFAULT_FLAG, DEFAULT_THEME);
      }
      applyTheme(newTheme);
      return { theme: newTheme };
    });
  },

  setTheme: (value) => {
    set(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, value);
        localStorage.setItem(THEME_DEFAULT_FLAG, DEFAULT_THEME);
      }
      applyTheme(value);
      return { theme: value };
    });
  },
}));

export default useThemeStore;
