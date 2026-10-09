/**
 * Every outbound channel call goes through here so adapters cannot drift onto plain HTTP.
 */
async function httpsRequest(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') {
    const err = new Error('Channel calls must use HTTPS');
    err.statusCode = 400;
    throw err;
  }
  const res = await fetch(target, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`Channel HTTP ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

module.exports = { httpsRequest };
