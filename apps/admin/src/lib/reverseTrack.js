/** Public courier track page for a reverse AWB, when we know the carrier. */
export function reverseTrackUrl(courier, awb) {
  const code = String(awb || '').trim();
  if (!code) return '';
  const name = String(courier || '').toLowerCase();
  if (name.includes('blue')) {
    return `https://www.bluedart.com/tracking/${encodeURIComponent(code)}`;
  }
  if (name.includes('delhivery')) {
    return `https://www.delhivery.com/track/package/${encodeURIComponent(code)}`;
  }
  if (name.includes('xpress')) {
    return `https://www.xpressbees.com/track?awb=${encodeURIComponent(code)}`;
  }
  if (name.includes('ecom')) {
    return `https://ecomexpress.in/tracking/?awb_field=${encodeURIComponent(code)}`;
  }
  return '';
}
