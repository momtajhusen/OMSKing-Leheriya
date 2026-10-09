/** One switch for every channel call. Pages never pick a host themselves. */
function apiModeOf(creds) {
  return String(creds?.apiMode || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
}

module.exports = { apiModeOf };
