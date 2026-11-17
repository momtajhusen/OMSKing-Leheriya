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

function apiType(creds) {
  return modeOf(creds) === 'sandbox' ? 'S' : 'P';
}

function assertCreds(creds) {
  const missing = [
    ['clientId', 'Client ID'],
    ['clientSecret', 'Client secret'],
    ['loginId', 'Login ID'],
    ['licenceKey', 'Licence key'],
    ['customerCode', 'Customer code (prepaid)'],
  ].filter(([key]) => !String(creds?.[key] || '').trim()).map(([, label]) => label);
  if (missing.length) {
    throw refuse(`Blue Dart was not called. The ${missing.join(', ')} is missing in Settings › Couriers › Bluedart.`);
  }
  if (!modeOf(creds)) {
    throw refuse('Blue Dart was not called. Set API environment (or Account mode) to live or sandbox in Settings › Couriers › Bluedart.');
  }
}

function parseJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function detailOf(text) {
  const json = parseJson(text);
  const errList = json['error-response'] || json.ErrorResponse || json.error || [];
  if (Array.isArray(errList) && errList[0]) {
    return String(errList[0].msg || errList[0].Message || errList[0].message || JSON.stringify(errList[0]));
  }
  if (json.GenerateWayBillResult?.Status?.[0]?.StatusInformation) {
    return String(json.GenerateWayBillResult.Status[0].StatusInformation);
  }
  if (json.title || json.message) return String(json.title || json.message);
  const raw = String(text || '').trim();
  return raw.slice(0, 240);
}

function profile(creds) {
  return {
    LoginID: String(creds.loginId).trim(),
    LicenceKey: String(creds.licenceKey).trim(),
    Api_type: apiType(creds),
  };
}

async function accessToken(creds, request) {
  // Blue Dart notice: ClientID/ClientSecret must be HTTP headers (not query string). Sample uses clientID + clientSecret.
  const res = await request('POST', `${host(creds)}/token/v1/login`, {
    headers: {
      clientID: String(creds.clientId).trim(),
      clientSecret: String(creds.clientSecret).trim(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: '',
  });
  if (res.status < 200 || res.status >= 300) {
    throw refuse(`Blue Dart login returned ${res.status}. ${detailOf(res.text) || 'Check Client ID and Client secret.'}`);
  }
  const token = String(parseJson(res.text).JWTToken || '').trim();
  if (!token) throw refuse('Blue Dart login sent no JWT token. Nothing was booked.');
  return token;
}

async function session(creds, opts = {}) {
  assertCreds(creds);
  const gated = withApiMode(creds);
  const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
  const token = await accessToken(gated, request);
  return async (what, method, path, body) => {
    const res = await request(method, `${host(gated)}${path}`, {
      headers: {
        JWTToken: token,
        clientID: String(gated.clientId).trim(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Blue Dart ${what} returned ${res.status}. ${detailOf(res.text) || 'Nothing was saved.'}`);
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
  const text = String(content).trim();
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
  if (!/^\d{6}$/.test(pickupPin)) throw refuse('WH-001 needs a 6-digit pincode before Blue Dart is called.');
  const cod = shipment.paymentMode === 'COD';
  const customerCode = String(cod && creds.customerCodeCod ? creds.customerCodeCod : creds.customerCode).trim();
  const call = await session(creds, opts);
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
        Dimensions: {
          Length: Number(shipment.lengthCm) || 1,
          Breadth: Number(shipment.breadthCm) || 1,
          Height: Number(shipment.heightCm) || 1,
        },
        PDFOutputNotRequired: false,
        PieceCount: Math.max(1, Number(shipment.quantity) || 1),
        ProductCode: productCode(creds),
        ProductType: 1,
        SubProductCode: cod ? 'C' : '',
        ItemCount: Math.max(1, Number(shipment.quantity) || 1),
        Commodity: {
          CommodityDetail1: String(shipment.description || shipment.orderNo).slice(0, 30),
        },
      },
    },
    Profile: profile(creds),
  });
  const result = waybillResult(json);
  const isError = result.IsError === true || result.IsError === 'true'
    || /fail|error/i.test(String(result.Status?.[0]?.StatusCode || ''));
  const awb = String(result.AWBNo || result.AwbNo || result.AWBNoGenerated || '').trim();
  if (isError || !awb) {
    throw refuse(`Blue Dart did not return an AWB. ${detailOf(JSON.stringify(result)) || 'Nothing was booked.'}`);
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

/** Blue Dart scans in the same { status, detail, eventKey } shape Delhivery tracking returns. */
async function track(creds, awb, opts = {}) {
  const tracking = String(awb || '').trim();
  if (!tracking) throw refuse('Blue Dart tracking needs an AWB.');
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
};
