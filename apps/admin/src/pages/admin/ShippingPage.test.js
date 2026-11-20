import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./ShippingPage.jsx', import.meta.url), 'utf8');

test('shipping has a separate RTO tab right after Exceptions', () => {
  const tabs = page.slice(page.indexOf('const TABS'), page.indexOf('];', page.indexOf('const TABS')));
  const exceptions = tabs.indexOf("id: 'exceptions'");
  const rto = tabs.indexOf("id: 'RTO', label: 'RTO'");
  assert.ok(exceptions >= 0);
  assert.ok(rto > exceptions);
});

test('courier Return to Origin shipments go to the RTO tab, return pickups stay in Exceptions', () => {
  const lib = fs.readFileSync(new URL('../../lib/shippingStatus.js', import.meta.url), 'utf8');
  assert.match(page, /import \{[^}]*shipmentStatus[^}]*\} from '\.\.\/\.\.\/lib\/shippingStatus'/);
  const status = lib.slice(lib.indexOf('function shipmentStatus'), lib.indexOf('const DAY'));
  assert.match(status, /if \(isCourierRto\(order\)\) return 'RTO';/);
  assert.match(status, /if \(order\.reversePickup\?\.returnId\) return 'Exception';/);
  const rtoCheck = lib.slice(lib.indexOf('function isCourierRto'), lib.indexOf('function shipmentStatus'));
  assert.match(rtoCheck, /channelStatus/);
  assert.match(rtoCheck, /includes\('RTO'\)/);
  assert.doesNotMatch(rtoCheck, /reversePickup/);
});

test('the Order ID column shows the Shopify order number with the internal id under it, like Orders', () => {
  const body = page.slice(page.indexOf('<TableBody>'));
  assert.match(body, /\{row\.channelOrderNo \|\| row\.id\}/);
  assert.match(body, /row\.channelOrderNo && row\.channelOrderNo !== row\.id/);
});

test('Shipments table header has a select-all checkbox for the filtered list', () => {
  assert.match(page, /aria-label="Select all shipments in this list"/);
  assert.match(page, /togglePage\(prev, selectableIds\)/);
  assert.match(page, /toggleId\(prev, row\.id\)/);
  assert.match(page, /selectableIds\.length > 0/);
});

test('shipments show a Payment column with COD / Prepaid', () => {
  assert.match(page, /<TableHead>Payment<\/TableHead>/);
  assert.match(page, /paymentModeOf\(row\)/);
});

test('a Prepaid order labelled COD by the courier pops a red alert straight away', () => {
  assert.match(page, /const codMismatch = useMemo\(\(\) => shipments\.filter\(prepaidLabelledCod\)/);
  assert.match(page, /open=\{codMismatch\.length > 0 && alertSeen !== mismatchKey\}/);
  assert.match(page, /border-red-600/);
  assert.match(page.slice(page.indexOf('<TableBody>')), /prepaidLabelledCod\(row\)/);
});

test('booking offers every enabled courier, not only Delhivery', () => {
  assert.doesNotMatch(page, />\s*Book Delhivery\s*</);
  assert.match(page, /Book courier/);
  assert.match(page, /readiness\?\.couriers/);
  assert.match(page, /\{bookingCouriers\.map\(\(courier\) => \(/);
  assert.match(page, /generateLabel\(labelFor\.id, undefined, picked\.api \? \{\} : \{ courier: picked\.code, awb: awb\.trim\(\) \}\)/);
  assert.match(page, /!picked\.api && \(/);
});

test('delivered shipments offer Book reverse, which books the reverse pickup', () => {
  assert.match(page, /row\.shipStatus === 'Delivered' && !isChannelManaged\(row\)/);
  assert.match(page, /Book reverse/);
  assert.match(page, /const bookReversePickup = useOrderStore\(\(s\) => s\.bookReversePickup\)/);
  assert.match(page, /await bookReversePickup\(reverseFor\.id, \{[\s\S]*courier: reverseCourier,[\s\S]*awb: reverseAwb/);
  assert.match(page, /title="Book reverse pickup"/);
  assert.match(page, /Reverse AWB/);
  assert.match(page, /delhivery\|blue\\s\*dart\|bluedart\/i\.test\(reverseCourier\)/);
  assert.match(page, /Leave blank to book via courier API/);
  assert.match(page, /Cancel reverse|reverseAwb/);
});

test('the Exceptions / RTO card counts both', () => {
  assert.match(page, /label="Exceptions \/ RTO" value=\{count\('Exception'\) \+ count\('RTO'\)\}/);
});

test('Shipping filters shipment history by courier without a large courier desk card', () => {
  assert.doesNotMatch(page, /Courier desk/);
  assert.doesNotMatch(page, /courierDeskCard/);
  assert.match(page, /courierFilter/);
  assert.match(page, /All couriers/);
  assert.match(page, /shipmentMatchesCourier/);
});

test('Label generated offers Ready to hand over; Ready offers Schedule Pickup; Pickup & Manifest lists manifests', () => {
  assert.match(page, /\{ id: 'pickup', label: 'Pickup & Manifest' \}/);
  assert.match(page, /scheduleManifestPickup/);
  assert.match(page, /Schedule Pickup/);
  assert.match(page, /Courier is not notified yet/);
  assert.match(page, /Download Manifest/);
  assert.match(page, /manifestPrintHtml/);
  assert.match(page, /handover-manifests\/\$\{encodeURIComponent\(manifestNo\)\}\/pickup/);
  assert.match(page, /row\.shipStatus === 'Label generated'/);
  assert.match(page, /sendToReady\(row\)/);
  assert.match(page, /generateManifestPickup\(row\)/);
});
