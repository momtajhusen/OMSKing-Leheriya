import { create } from 'zustand';
import api from '../lib/api';

const useMarketingImageStore = create((set, get) => ({
  images: {},
  status: 'idle',
  async load() {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const { data } = await api.get('/marketing-images');
      set({ images: data.data || {}, status: 'ready' });
    } catch {
      set({ status: 'error' });
    }
  },
  put(name, image) {
    set((state) => ({ images: { ...state.images, [name]: image } }));
  },
  remove(name) {
    set((state) => {
      const images = { ...state.images };
      delete images[name];
      return { images };
    });
  },
}));

export default useMarketingImageStore;
