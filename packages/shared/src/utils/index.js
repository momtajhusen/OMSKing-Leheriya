const formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount) || 0);
};

const formatDate = (date, locale = 'en-IN') => {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const generateId = (prefix = '') => {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
};

module.exports = {
  formatCurrency,
  formatDate,
  generateId,
};
