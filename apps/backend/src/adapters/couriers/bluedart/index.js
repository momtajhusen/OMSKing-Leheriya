const https = require('https');
const { URL } = require('url');
const { gatedRequest } = require('../../liveGate');

const LIVE_HOST = 'https://apigateway.bluedart.com/in/transportation';
const SANDBOX_HOST = 'https://apigateway-sandbox.bluedart.com/in/transportation';

function httpCall(method, url, { headers = {}, body } = {}) {
  const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      const err = new Error('Channel calls must use HTTPS');
      err.statusCode = 400;
      reject(err);
      return;
    }
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method,
      family: 4,
      timeout: 20000,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function refuse(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.terminal = true;
  return err;
}

/** Blue Dart catalog uses accountMode; liveGate expects apiMode. */
function modeOf(creds) {
  const raw = String(creds?.apiMode || creds?.accountMode || '').trim().toLowerCase();
  if (raw === 'sandbox' || raw === 's') return 'sandbox';
  if (raw === 'live' || raw === 'production' || raw === 'p') return 'live';
  return '';
}

function withApiMode(creds) {
  const apiMode = modeOf(creds);
  return apiMode ? { ...creds, apiMode } : { ...creds };
}

function host(creds) {
  return modeOf(creds) === 'sandbox' ? SANDBOX_HOST : LIVE_HOST;
}

/** Profile + Type header. Some live accounts are registered as Api_type S (not P). */
function apiType(creds) {
  const forced = String(creds?.apiType || creds?.Api_type || '').trim().toUpperCase();
  if (forced === 'S' || forced === 'P') return forced;
  return modeOf(creds) === 'sandbox' ? 'S' : 'P';
}

function assertCreds(creds) {
  const missing = [
    ['clientId', 'Client ID (Apigee)'],
    ['clientSecret', 'Client secret (Apigee)'],
    ['loginId', 'Login ID'],
    ['licenceKey', 'Licence key'],
    ['customerCode', 'Customer code (prepaid)'],
  ].filter(([key]) => !String(creds?.[key] || '').trim()).map(([, label]) => label);
  if (missing.length) {
    throw refuse(`Blue Dart was not called. The ${missing.join(', ')} is missing in Settings › Couriers › Bluedart. API booking needs Apigee Client ID and Client secret from the DHL developer app.`);
  }
  if (!modeOf(creds)) {
    throw refuse('Blue Dart was not called. Set API environment (or Account mode) to live or sandbox in Settings › Couriers › Bluedart.');
  }
}

function hasApigee(creds) {
  return Boolean(String(creds?.clientId || '').trim() && String(creds?.clientSecret || '').trim());
}

function assertTrackCreds(creds) {
  if (!String(creds?.loginId || '').trim()
    || !(String(creds?.trackingLicenceKey || '').trim() || String(creds?.licenceKey || '').trim())) {
    throw refuse('Blue Dart was not called. Login ID and licence key are missing in Settings › Couriers › Bluedart.');
  }
  if (!modeOf(creds)) {
    throw refuse('Blue Dart was not called. Set API environment (or Account mode) to live or sandbox in Settings › Couriers › Bluedart.');
  }
}

function parseJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function rawDetail(text) {
  const json = parseJson(text);
  const errList = json['error-response'] || json.ErrorResponse || json.error || [];
  if (Array.isArray(errList) && errList[0]) {
    const row = errList[0];
    const statusInfo = row.Status?.[0]?.StatusInformation || row.Status?.[0]?.StatusCode;
    return String(statusInfo || row.msg || row.Message || row.message || JSON.stringify(row));
  }
  if (json.GenerateWayBillResult?.Status?.[0]?.StatusInformation) {
    return String(json.GenerateWayBillResult.Status[0].StatusInformation);
  }
  if (json.title || json.message) return String(json.title || json.message);
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Map Blue Dart / Apigee wording into clear English the client can act on. */
function explainBlueDart(raw, { what = 'request' } = {}) {
  const text = String(raw || '');
  const lower = text.toLowerCase();
  if (/invalid api type|requestauthenticationfailed/i.test(text)) {
    return 'Blue Dart rejected the API type. In Settings › Couriers › Bluedart set API type (Profile) to S or P so it matches your Blue Dart account, then try again.';
  }
  if (/insufficient wallet|wallet balance/i.test(text)) {
    return 'Blue Dart wallet balance is too low to book this shipment. Top up the Blue Dart wallet, then try again.';
  }
  if (/pickup time cannot be blank|pickupdate|pickup time/i.test(text)) {
    return 'Blue Dart needs a pickup date and time. Nothing was booked. Try again; if it keeps failing, check the warehouse phone and pincode.';
  }
  if (/dimensions mandatory/i.test(text)) {
    return 'Blue Dart needs package length, width and height. Set them on the order items or in Settings › Package defaults.';
  }
  if (/not serviceable|pincode|pin code/i.test(lower) && /invalid|not|fail/i.test(lower)) {
    return 'Blue Dart does not serve this delivery pincode. Check the address or choose another courier.';
  }
  if (/access to the method is not allowed|unauthorized/i.test(text)) {
    return 'Blue Dart refused access. Check the Apigee Client ID and Client secret in Settings › Couriers › Bluedart, and confirm this DHL app has Waybill access.';
  }
  if (/unsupported media type/i.test(text)) {
    return 'Blue Dart rejected the request format. Update OMSKing or contact support with this error.';
  }
  if (text) return `Blue Dart ${what} failed: ${text.slice(0, 200)}`;
  return `Blue Dart ${what} failed. Nothing was booked.`;
}

function detailOf(text) {
  return explainBlueDart(rawDetail(text));
}

function profile(creds) {
  return {
    LoginID: String(creds.loginId).trim(),
    LicenceKey: String(creds.licenceKey).trim(),
    Api_type: apiType(creds),
  };
}

async function accessToken(creds, request) {
  // Live Apigee returns JWTToken on GET with clientID/clientSecret headers. POST often returns an empty 200.
  const res = await request('GET', `${host(creds)}/token/v1/login`, {
    headers: {
      clientID: String(creds.clientId).trim(),
      clientSecret: String(creds.clientSecret).trim(),
      Accept: 'application/json',
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw refuse(`Blue Dart login failed (HTTP ${res.status}). ${explainBlueDart(rawDetail(res.text), { what: 'login' })} Check Client ID and Client secret in Settings › Couriers › Bluedart.`);
  }
  const token = String(parseJson(res.text).JWTToken || '').trim();
  if (!token) {
    throw refuse('Blue Dart login returned no access token. Check the Apigee Client ID and Client secret in Settings › Couriers › Bluedart. Nothing was booked.');
  }
  return token;
}

async function session(creds, opts = {}) {
  assertCreds(creds);
  const gated = withApiMode(creds);
  const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
  const token = await accessToken(gated, request);
  return async (what, method, path, body) => {
    const type = apiType(gated);
    const res = await request(method, `${host(gated)}${path}`, {
      headers: {
        JWTToken: token,
        clientID: String(gated.clientId).trim(),
        clientid: String(gated.clientId).trim(),
        Type: type,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(explainBlueDart(rawDetail(res.text), { what }));
      err.statusCode = [400, 401, 403, 404].includes(res.status) ? 400 : 502;
      err.terminal = err.statusCode === 400;
      throw err;
    }
    return parseJson(res.text);
  };
}

function productCode(creds) {
  const service = String(creds.serviceType || '').toLowerCase();
  if (service.includes('surface') || service.includes('dart')) return 'D';
  return 'A';
}

function kg(weightGrams) {
  return Math.max(0.1, Math.round((Number(weightGrams) || 0) / 100) / 10);
}

function labelBuffer(content) {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content.slice(0, 4).toString() === '%PDF' ? content : null;
  // Some Blue Dart responses return the PDF as a byte array instead of base64.
  if (Array.isArray(content)) {
    const bytes = Buffer.from(content);
    return bytes.slice(0, 4).toString() === '%PDF' ? bytes : null;
  }
  if (typeof content === 'object' && content.type === 'Buffer' && Array.isArray(content.data)) {
    const bytes = Buffer.from(content.data);
    return bytes.slice(0, 4).toString() === '%PDF' ? bytes : null;
  }
  const text = String(content).trim().replace(/^data:application\/pdf;base64,/i, '');
  if (!text) return null;
  try {
    const bytes = Buffer.from(text, 'base64');
    return bytes.slice(0, 4).toString() === '%PDF' ? bytes : null;
  } catch {
    return null;
  }
}

function waybillResult(json) {
  return json.GenerateWayBillResult || json.GenerateWayBillResponse || json;
}

/** One Blue Dart waybill + label PDF for a Shopify parcel. */
async function book(creds, shipment, opts = {}) {
  assertCreds(creds);
  if (!(shipment.weightGrams > 0 && shipment.lengthCm > 0 && shipment.breadthCm > 0 && shipment.heightCm > 0)) {
    throw refuse('Package weight and size are missing for this order. Set them on the order items or in Settings › Package defaults. Blue Dart was not called.');
  }
  const pincode = String(shipment.pincode || '').trim();
  if (!/^\d{6}$/.test(pincode)) throw refuse('This order has no 6-digit delivery pincode, so Blue Dart was not called.');
  const pickup = shipment.pickup || {};
  const pickupPin = String(pickup.pincode || '').trim();
  if (!/^\d{6}$/.test(pickupPin)) {
    throw refuse('The pickup warehouse needs a 6-digit pincode before Blue Dart can book. Set it on the warehouse in Settings › Warehouses.');
  }
  const cod = shipment.paymentMode === 'COD';
  const customerCode = String(cod && creds.customerCodeCod ? creds.customerCodeCod : creds.customerCode).trim();
  const call = await session(creds, opts);
  const pickupAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const pickupTime = `${String(pickupAt.getHours()).padStart(2, '0')}${String(pickupAt.getMinutes()).padStart(2, '0')}`;
  const json = await call('GenerateWayBill', 'POST', '/waybill/v1/GenerateWayBill', {
    Request: {
      Consignee: {
        ConsigneeName: String(shipment.name || 'Customer').slice(0, 30),
        ConsigneeAddress1: String(shipment.address || '').slice(0, 30),
        ConsigneeAddress2: String(shipment.city || '').slice(0, 30),
        ConsigneeAddress3: String(shipment.state || '').slice(0, 30),
        ConsigneePincode: pincode,
        ConsigneeMobile: String(shipment.phone || '').replace(/\D/g, '').slice(-10),
        ConsigneeAttention: String(shipment.name || 'Customer').slice(0, 30),
      },
      Shipper: {
        CustomerAddress1: String(pickup.line1 || pickup.address || '').slice(0, 30),
        CustomerAddress2: String(pickup.city || '').slice(0, 30),
        CustomerAddress3: String(pickup.state || '').slice(0, 30),
        CustomerCode: customerCode,
        CustomerMobile: String(pickup.phone || '').replace(/\D/g, '').slice(-10),
        CustomerName: String(pickup.name || 'Shipper').slice(0, 30),
        CustomerPincode: pickupPin,
        OriginArea: String(creds.originArea || '').trim() || undefined,
        Sender: String(pickup.name || 'Shipper').slice(0, 30),
        VendorCode: String(creds.vendorCode || customerCode).trim() || undefined,
      },
      Services: {
        ActualWeight: kg(shipment.weightGrams),
        CollectableAmount: cod ? Math.round((Number(shipment.codAmount ?? shipment.amount) || 0) * 100) / 100 : 0,
        CreditReferenceNo: String(shipment.orderNo).slice(0, 20),
        DeclaredValue: Math.round((Number(shipment.amount) || 0) * 100) / 100,
        // Wallet/live accounts require Dimensions as an array with Count (object form returns "Dimensions mandatory").
        Dimensions: [{
          Length: Number(shipment.lengthCm) || 1,
          Breadth: Number(shipment.breadthCm) || 1,
          Height: Number(shipment.heightCm) || 1,
          Count: Math.max(1, Number(shipment.quantity) || 1),
        }],
        PDFOutputNotRequired: false,
        PieceCount: Math.max(1, Number(shipment.quantity) || 1),
        ProductCode: productCode(creds),
        ProductType: 1,
        SubProductCode: cod ? 'C' : '',
        ItemCount: Math.max(1, Number(shipment.quantity) || 1),
        Commodity: {
          CommodityDetail1: String(shipment.description || shipment.orderNo).slice(0, 30),
        },
        PickupDate: `/Date(${pickupAt.getTime()})/`,
        PickupTime: pickupTime,
        RegisterPickup: true,
      },
    },
    Profile: profile(creds),
  });
  const result = waybillResult(json);
  const isError = result.IsError === true || result.IsError === 'true'
    || /fail|error/i.test(String(result.Status?.[0]?.StatusCode || ''));
  const awb = String(result.AWBNo || result.AwbNo || result.AWBNoGenerated || '').trim();
  if (isError || !awb) {
    throw refuse(explainBlueDart(rawDetail(JSON.stringify(result)), { what: 'label' }) || 'Blue Dart did not return a tracking number. Nothing was booked.');
  }
  const labelPdf = labelBuffer(result.AWBPrintContent || result.AwbPrintContent || result.LabelPrintContent);
  return {
    awb,
    shipmentId: awb,
    paymentMode: cod ? 'COD' : 'Prepaid',
    labelPdf,
  };
}

async function cancel(creds, awb, opts = {}) {
  const tracking = String(awb || '').trim();
  if (!tracking) throw refuse('Blue Dart cancel needs an AWB.');
  const call = await session(creds, opts);
  await call('CancelWaybill', 'POST', '/waybill/v1/CancelWaybill', {
    Request: { AWBNo: tracking },
    Profile: profile(creds),
  });
  return { cancelled: true, awb: tracking };
}

const SCAN_STATUS = [
  [/rto|return to origin|returned to shipper/i, 'rto'],
  [/undeliver|consignee|refused|not available|ndr|delivery attempted/i, 'ndr'],
  [/out for delivery/i, 'out_for_delivery'],
  [/delivered|shipment delivered/i, 'delivered'],
  [/transit|arrived|departed|received at|reached/i, 'in_transit'],
  [/picked|pickup done|shipment picked/i, 'picked_up'],
];

function mapScanStatus(text) {
  const value = String(text || '');
  for (const [re, status] of SCAN_STATUS) {
    if (re.test(value)) return status;
  }
  return '';
}

function shipmentRows(payload) {
  const data = payload.ShipmentData || payload.shipmentData || payload;
  const shipment = data.Shipment || data.shipment;
  if (!shipment) return [];
  return Array.isArray(shipment) ? shipment : [shipment];
}

function eventsFromPayload(tracking, payload) {
  const events = [];
  for (const row of shipmentRows(payload)) {
    const scans = Array.isArray(row.Scans) ? row.Scans : (row.Scans ? [row.Scans] : []);
    for (const scan of scans) {
      const detail = scan.ScanDetail || scan;
      const status = mapScanStatus(detail.Scan || detail.ScanCode || detail.Instructions || '');
      if (!status) continue;
      const when = `${detail.ScanDate || ''}${detail.ScanTime || detail.ScanDateTime || status}`;
      events.push({
        status,
        detail: String(detail.Scan || detail.Instructions || detail.ScanCode || ''),
        eventKey: `${tracking}:${when}:${status}`,
      });
    }
    if (!events.length) {
      const status = mapScanStatus(row.Status || row.StatusType || '');
      if (status) events.push({ status, detail: String(row.Status || ''), eventKey: `${tracking}:${status}:current` });
    }
  }
  return events;
}

/** Shipway-style Login ID + licence key tracking (no Apigee JWT). */
async function trackLegacy(creds, awb, opts = {}) {
  assertTrackCreds(creds);
  const tracking = String(awb || '').trim();
  const gated = withApiMode(creds);
  const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
  const licence = String(creds.trackingLicenceKey || creds.licenceKey).trim();
  const qs = new URLSearchParams({
    handler: 'tnt',
    action: 'custawbquery',
    loginid: String(creds.loginId).trim(),
    awb: 'awb',
    numbers: tracking,
    format: 'json',
    lickey: licence,
    verno: '1',
    scan: '1',
  });
  const url = `https://api.bluedart.com/servlet/RoutingServlet?${qs}`;
  const res = await request('GET', url, { headers: { Accept: 'application/json' } });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(explainBlueDart(rawDetail(res.text), { what: 'tracking' }));
    err.statusCode = [400, 401, 403, 404].includes(res.status) ? 400 : 502;
    err.terminal = err.statusCode === 400;
    throw err;
  }
  const payload = parseJson(res.text);
  if (payload.ShipmentData?.Error && !payload.ShipmentData?.Shipment) {
    return { status: '', events: [] };
  }
  const events = eventsFromPayload(tracking, payload);
  return { status: events.at(-1)?.status || '', events };
}

/** Blue Dart scans in the same { status, detail, eventKey } shape Delhivery tracking returns. */
async function track(creds, awb, opts = {}) {
  const tracking = String(awb || '').trim();
  if (!tracking) throw refuse('Blue Dart tracking needs an AWB.');
  // Apigee JWT path when Client ID/Secret are present; otherwise Shipway-style RoutingServlet.
  if (!hasApigee(creds)) return trackLegacy(creds, tracking, opts);

  const call = await session(creds, opts);
  const licence = String(creds.trackingLicenceKey || creds.licenceKey).trim();
  const qs = new URLSearchParams({
    handler: 'tnt',
    action: 'custawbquery',
    loginid: String(creds.loginId).trim(),
    awb: 'awb',
    numbers: tracking,
    format: 'json',
    lickey: licence,
    verno: '1',
    scan: '1',
  });
  const payload = await call('tracking', 'GET', `/tracking/v1/shipment?${qs}`);
  const events = eventsFromPayload(tracking, payload);
  return { status: events.at(-1)?.status || '', events };
}

module.exports = {
  book,
  cancel,
  track,
  host,
  modeOf,
  mapScanStatus,
  httpCall,
  hasApigee,
};
