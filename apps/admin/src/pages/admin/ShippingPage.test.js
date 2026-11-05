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
  const status = page.slice(page.indexOf('function shipmentStatus'), page.indexOf('export default'));
  assert.match(status, /if \(isCourierRto\(order\)\) return 'RTO';/);
  assert.match(status, /if \(order\.reversePickup\?\.returnId\) return 'Exception';/);
  const rtoCheck = page.slice(page.indexOf('function isCourierRto'), page.indexOf('function shipmentStatus'));
  assert.match(rtoCheck, /channelStatus/);
  assert.match(rtoCheck, /includes\('RTO'\)/);
  assert.doesNotMatch(rtoCheck, /reversePickup/);
});

test('the Order ID column shows the Shopify order number with the internal id under it, like Orders', () => {
  const body = page.slice(page.indexOf('<TableBody>'));
  assert.match(body, /\{row\.channelOrderNo \|\| row\.id\}/);
  assert.match(body, /row\.channelOrderNo && row\.channelOrderNo !== row\.id/);
});

test('shipments show a Payment column with COD / Prepaid', () => {
  const header = page.slice(page.indexOf('<TableHeader>'), page.indexOf('</TableHeader>'));
  assert.match(header, /<TableHead>Payment<\/TableHead>/);
  assert.match(page.slice(page.indexOf('<TableBody>')), /paymentModeOf\(row\)/);
});

test('a Prepaid order labelled COD by the courier pops a red alert straight away', () => {
  assert.match(page, /const codMismatch = useMemo\(\(\) => shipments\.filter\(prepaidLabelledCod\)/);
  assert.match(page, /open=\{codMismatch\.length > 0 && alertSeen !== mismatchKey\}/);
  assert.match(page, /border-red-600/);
  assert.match(page.slice(page.indexOf('<TableBody>')), /prepaidLabelledCod\(row\)/);
});

test('booking offers every enabled courier, not only Delhivery', () => {
  const actions = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'));
  assert.doesNotMatch(actions, />\s*Book Delhivery\s*</);
  assert.match(actions, /Book courier/);
  assert.match(page, /readiness\?\.couriers/);
  assert.match(page, /\{bookingCouriers\.map\(\(courier\) => \(/);
  assert.match(page, /generateLabel\(labelFor\.id, undefined, picked\.api \? \{\} : \{ courier: picked\.code, awb: awb\.trim\(\) \}\)/);
  assert.match(page, /!picked\.api && \(/);
});

test('delivered shipments offer Book reverse, which books the reverse pickup', () => {
  const actions = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'));
  assert.match(actions, /row\.shipStatus === 'Delivered' && !isChannelManaged\(row\)/);
  assert.match(actions, /Book reverse/);
  assert.match(page, /const bookReversePickup = useOrderStore\(\(s\) => s\.bookReversePickup\)/);
  assert.match(page, /await bookReversePickup\(reverseFor\.id, \{ reason: reverseReason, courier: reverseCourier \}\)/);
  assert.match(page, /title="Book reverse pickup"/);
});

test('the Exceptions / RTO card counts both', () => {
  assert.match(page, /label="Exceptions \/ RTO" value=\{count\('Exception'\) \+ count\('RTO'\)\}/);
});
