/** Myntra MNOW / immediate dispatch (SFX_HL / MYSFXHL… AWB). */
export function isMyntraHyperlocal(order) {
  if (!order || order.channel !== 'Myntra') return false;
  if (order.hyperlocal) return true;
  const blob = [
    order.awb,
    order.courier,
    ...(order.channelLines || []).flatMap((line) => [line.trackingNumber, line.courierCode]),
  ].filter(Boolean).join(' ');
  return /SFX_?HL|HYPERLOCAL|MNOW/i.test(blob);
}
