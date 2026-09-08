import { create } from 'zustand';

const useThemeStore = create((set) => ({
  theme: (() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('oms-theme');
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  })(),

  initializeTheme: () => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('oms-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = stored || (prefersDark ? 'dark' : 'light');
      
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
      set({ theme });
    }
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem('oms-theme', newTheme);
        if (newTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      return { theme: newTheme };
    });
  },

  setTheme: (value) => {
    set(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('oms-theme', value);
        if (value === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      return { theme: value };
    });
  },
}));

export default useThemeStore;