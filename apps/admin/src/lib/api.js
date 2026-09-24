import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://omskingapi.codersalpha.com/api/v1',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const url = original?.url || '';
    if (status !== 401 || original?._retry || url.includes('/auth/refresh') || url.includes('/auth/login')) {
      return Promise.reject(error);
    }
    original._retry = true;
    try {
      if (!refreshing) {
        refreshing = api.post('/auth/refresh').finally(() => {
          refreshing = null;
        });
      }
      const { data } = await refreshing;
      const access = data?.data?.accessToken;
      const user = data?.data?.user;
      if (access) {
        const { default: useAuthStore } = await import('../stores/authStore');
        useAuthStore.getState().persist(access, user);
      }
      original.headers.Authorization = `Bearer ${access}`;
      return api(original);
    } catch (err) {
      const { default: useAuthStore } = await import('../stores/authStore');
      useAuthStore.getState().logoutLocal();
      return Promise.reject(err);
    }
  },
);

export function apiError(err, fallback = 'Request failed') {
  return err.response?.data?.message || err.message || fallback;
}

export function apiFormError(err, fallback = 'Please check the form and try again') {
  const data = err.response?.data || {};
  const fields = {};
  (data.errors || []).forEach((item) => {
    const key = item.field || item.path;
    if (key && item.message && !fields[key]) fields[key] = item.message;
  });
  const network = !err.response;
  return {
    message: network ? 'Cannot reach the server. Check that the API is running.' : (data.message || err.message || fallback),
    fields,
    status: err.response?.status || 0,
  };
}

export default api;
