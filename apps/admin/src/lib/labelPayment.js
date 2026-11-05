export function paymentModeOf(order) {
  const text = String(order?.paymentMode || '').trim();
  if (!text) return '';
  if (/cod|cash on delivery/i.test(text)) return 'COD';
  if (/^void$/i.test(text)) return 'Void';
  return 'Prepaid';
}

export function prepaidLabelledCod(order) {
  return paymentModeOf(order) === 'Prepaid' && order?.labelPaymentMode === 'COD';
}
