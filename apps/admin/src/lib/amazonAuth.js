/** Amazon's redirect back to OMSKing -> what the callback page should do. Amazon is never called from here. */
export function readAmazonCallback(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('error')) {
    return {
      kind: 'denied',
      message: 'Amazon was not connected because the authorization was cancelled on Amazon. You can try again any time.',
    };
  }
  const state = params.get('state') || '';
  const code = params.get('spapi_oauth_code') || '';
  const sellingPartnerId = params.get('selling_partner_id') || '';
  if (!state || !code) {
    return {
      kind: 'incomplete',
      message: 'Amazon did not send back an authorization code, so Amazon was not connected. Start again with Authorize with Amazon.',
    };
  }
  return { kind: 'ready', body: { state, code, sellingPartnerId } };
}
