import toast from 'react-hot-toast';

export const toastHelper = {
  success: (message) => toast.success(message),
  error: (message) => toast.error(message),
  info: (message) => toast.info(message),
  loading: (message) => toast.loading(message),
};

export default toastHelper;