const https = require('https');
const { URL } = require('url');

function describeErr(err) {
  const cause = err.cause || err;
  const bits = [err.message];
  if (cause.code) bits.push(cause.code);
  if (cause.message && cause.message !== err.message) bits.push(cause.message);
  return bits.filter(Boolean).join(' — ');
}

function httpPost(url, { headers = {}, body = '', timeoutMs = 20000 } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      family: 4,
      timeout: timeoutMs,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

function myntraBases(creds) {
  const extra = String(creds.apiBaseUrl || '').trim().replace(/\/$/, '');
  const ordered = [extra, 'https://api.pretr.com', 'https://pretr.com', 'https://www.pretr.com'];
  return [...new Set(ordered.filter(Boolean))];
}

async function generateMyntraToken(base, merchantId, secretKey) {
  const url = `${base}/authorization/generate_token`;
  const json = await httpPost(url, {
    headers: {
      secret_key: secretKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchant_id: merchantId }),
  });
  if (json.status >= 200 && json.status < 300) return { ok: true, base, status: json.status, text: json.text };
  if (json.status !== 400 && json.status !== 415) {
    return { ok: false, base, status: json.status, text: json.text };
  }
  const form = await httpPost(url, {
    headers: {
      secret_key: secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `merchant_id=${encodeURIComponent(merchantId)}`,
  });
  if (form.status >= 200 && form.status < 300) return { ok: true, base, status: form.status, text: form.text };
  return { ok: false, base, status: form.status, text: form.text || json.text };
}

function looksLikePretrApi(result) {
  const text = result.text || '';
  if (/access_token|refresh_token|statusCode|statusMessage|Invalid merchant|Merchant Id/i.test(text)) return true;
  if (result.status === 401 || result.status === 403) return true;
  if (/<!DOCTYPE|<html/i.test(text)) return false;
  return Boolean(result.status) && result.status !== 404 && result.status !== 405 && result.status < 500;
}

async function pingMyntra(creds) {
  const merchantId = creds.merchantId;
  const secretKey = creds.secretKey;
  if (!merchantId || !secretKey) {
    return { ok: false, message: 'Merchant Id and Secret Key are required' };
  }
  const bases = myntraBases(creds);
  let lastNetErr;
  for (const base of bases) {
    try {
      const result = await generateMyntraToken(base, merchantId, secretKey);
      if (!looksLikePretrApi(result)) {
        lastNetErr = new Error(`${base} is not the Pretr token API (${result.status})`);
        continue;
      }
      if (result.ok) {
        return { ok: true, message: `Myntra PPMP accepted Merchant Id + Secret Key (${base})` };
      }
      const snippet = (result.text || '').replace(/\s+/g, ' ').slice(0, 180);
      return {
        ok: false,
        message: `Myntra Pretr ${result.status} at ${base}: ${snippet || 'Auth rejected. Confirm Merchant Id + Secret with Myntra PPMP (partnerportal.myntra.com).'}`,
      };
    } catch (err) {
      lastNetErr = err;
    }
  }
  return {
    ok: false,
    incomplete: true,
    message: `Myntra credentials are saved. Live ping cannot resolve Pretr (api.pretr.com has no DNS). Paste the current host from Myntra in “Pretr API host” if they gave you one. ${describeErr(lastNetErr)}`,
  };
}

async function pingAmazon(creds) {
  if (!creds.sellerId) return { ok: false, message: 'Seller ID is required' };
  if (!creds.refreshToken) return { ok: false, message: 'SP-API refresh token is required' };
  if (!creds.lwaClientId || !creds.lwaClientSecret) {
    return {
      ok: false,
      incomplete: true,
      message: 'Amazon details saved. Live test needs LWA Client ID + Client Secret from Amazon Developer Console (OMSKing SP-API app). Guru’s app cannot be reused.',
    };
  }
  try {
    const res = await httpPost('https://api.amazon.com/auth/o2/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.lwaClientId,
        client_secret: creds.lwaClientSecret,
      }).toString(),
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, message: 'Amazon SP-API refresh token exchanged successfully' };
    }
    let detail = (res.text || '').replace(/\s+/g, ' ').slice(0, 180);
    try {
      const parsed = JSON.parse(res.text);
      detail = parsed.error_description || parsed.error || detail;
    } catch (_) { /* keep snippet */ }
    return { ok: false, message: `Amazon LWA ${res.status}: ${detail}` };
  } catch (err) {
    return { ok: false, message: `Cannot reach Amazon LWA. ${describeErr(err)}` };
  }
}

async function pingShopify(creds) {
  const shop = String(creds.shopUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!shop || !creds.adminToken) {
    if (creds.clientId || creds.apiSecret) {
      return {
        ok: false,
        incomplete: true,
        message: 'Shopify Client ID + API secret are saved. Live ping still needs the Shop URL and Admin API token (shpat_…).',
      };
    }
    return { ok: false, message: 'Shop URL and Admin API token are required' };
  }
  try {
    const res = await httpPost(`https://${shop}/admin/api/2024-10/graphql.json`, {
      headers: {
        'X-Shopify-Access-Token': creds.adminToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ shop { name } }' }),
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, message: 'Shopify Admin API reachable' };
    }
    return { ok: false, message: `Shopify ${res.status}` };
  } catch (err) {
    return { ok: false, message: `Cannot reach Shopify. ${describeErr(err)}` };
  }
}

async function pingChannel(channel, creds) {
  if (channel === 'myntra') return pingMyntra(creds);
  if (channel === 'amazon') return pingAmazon(creds);
  if (channel === 'shopify') return pingShopify(creds);
  return { ok: false, incomplete: true, message: 'This channel can be saved. Live ping is not wired yet.' };
}

module.exports = { pingChannel };
