import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const home = read('./HomePage.jsx');
const features = read('./FeaturesPage.jsx');
const about = read('./AboutPage.jsx');
const contact = read('./ContactPage.jsx');
const demo = read('./DemoRequestPage.jsx');
const marketing = read('../../components/marketing/MarketingCta.jsx');
const layout = read('../../components/layout/PublicLayout.jsx');

const CHANNELS = ['Shopify', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'AJIO', 'Nykaa'];

test('the channel strip shows every channel OMSKing connects, plus a partner connector', () => {
  for (const name of CHANNELS) assert.match(marketing, new RegExp(`name: '${name}'`));
  assert.match(marketing, /Partner API/);
  assert.doesNotMatch(marketing, /Not at launch/);
});

test('public copy no longer says OMSKing is a three-channel tool', () => {
  for (const source of [home, features, about, contact, demo, marketing, layout]) {
    assert.doesNotMatch(source, /Shopify · Amazon · Myntra'/);
    assert.doesNotMatch(source, /three launch channels|Launch channels: Shopify, Amazon, Myntra/);
    assert.doesNotMatch(source, /Shopify, Amazon and Myntra (become|sync|—)/);
  }
  assert.match(home, /multichannel/i);
  assert.match(layout, /Flipkart/);
});

test('the browser title and meta description describe a multichannel OMS', () => {
  const html = read('../../../index.html');
  assert.match(html, /<title>OMSKing — Multichannel OMS[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*Flipkart[^"]*"/);
});

test('the demo form offers the same seven channels the backend accepts', () => {
  assert.match(demo, /const CHANNELS = \['Shopify', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'AJIO', 'Nykaa'\];/);
});

test('features list the modules the product actually ships', () => {
  for (const name of ['Delhivery', 'WhatsApp', 'Webhooks', 'API keys', 'Audit', 'Reports', 'Opening stock']) {
    assert.match(features, new RegExp(name));
  }
});
