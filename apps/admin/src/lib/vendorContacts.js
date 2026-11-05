export const VENDOR_RENAME_NOTE = 'Renaming here does not change the vendor name in Shopify. Add the Shopify name under Shopify vendor names so its orders still match.';

/** Warning text for other vendors that share the saved phone or email; empty when none. */
export function sharedContactWarning(shared) {
  const parts = [];
  if (shared?.phone?.length) parts.push(`Same phone is also used by ${shared.phone.join(', ')}.`);
  if (shared?.email?.length) parts.push(`Same email is also used by ${shared.email.join(', ')}.`);
  return parts.join(' ');
}
