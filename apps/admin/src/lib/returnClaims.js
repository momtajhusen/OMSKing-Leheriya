const CLAIM_NAMES = { safet: 'SAFE-T claim', myntra: 'Myntra claim' };
const CLAIM_STATUS = { to_file: 'to file', filed: 'filed', approved: 'approved', rejected: 'rejected' };
const REFUND_TEXT = { not_due: 'No refund due', pending: 'Refund pending', rejected: 'Refund rejected' };

export const CLAIM_STATUSES = [
  { value: 'none', label: 'No claim' },
  { value: 'to_file', label: 'To file' },
  { value: 'filed', label: 'Filed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export const REFUND_STATUSES = [
  { value: 'pending', label: 'Refund pending' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'rejected', label: 'Refund rejected' },
  { value: 'not_due', label: 'No refund due' },
];

/** 'rto' for a return to origin (courier could not deliver), else 'customer'. */
export function kindOf(ret) {
  return ret?.kind === 'rto' || ret?.type === 'rto' ? 'rto' : 'customer';
}

export function splitByKind(rows) {
  const out = { customer: [], rto: [] };
  for (const row of rows || []) out[kindOf(row)].push(row);
  return out;
}

/** Amazon = SAFE-T claim, Myntra = Myntra claim. */
export function claimName(type) {
  return CLAIM_NAMES[type] || '';
}

/** "SAFE-T claim: filed · 123" / "Myntra claim: approved · ₹650"; '' when there is no claim. */
export function claimText(claim) {
  const name = claimName(claim?.type);
  const status = CLAIM_STATUS[claim?.status];
  if (!name || !status) return '';
  const extra = claim.status === 'approved' && claim.amount ? ` · ₹${claim.amount}` : claim.claimId ? ` · ${claim.claimId}` : '';
  return `${name}: ${status}${extra}`;
}

export function refundText(ret) {
  if (ret?.refundStatus === 'refunded') return `Refunded${ret.refundAmount ? ` ₹${ret.refundAmount}` : ''}`;
  return REFUND_TEXT[ret?.refundStatus] || 'Refund pending';
}
