/** Real courier and marketplace sockets run only when credentials name the environment. */
function outboundMode(creds) {
  const mode = String(creds?.apiMode || '').trim().toLowerCase();
  return mode === 'live' || mode === 'sandbox' ? mode : '';
}

function gatedRequest(creds, request, fallback, { allowSandbox = false } = {}) {
  if (typeof request === 'function' && request !== fallback) return request;
  const mode = outboundMode(creds);
  if (mode === 'live' || (allowSandbox && mode === 'sandbox')) return fallback;
  const err = new Error('Live API was not called. Set apiMode to live.');
  err.statusCode = 400;
  err.terminal = true;
  throw err;
}

module.exports = { outboundMode, gatedRequest };
