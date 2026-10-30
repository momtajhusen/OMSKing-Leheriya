import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const cta = read('../../components/marketing/MarketingCta.jsx');
const css = read('../../index.css');
const home = read('./HomePage.jsx');
const features = read('./FeaturesPage.jsx');
const about = read('./AboutPage.jsx');
const pricing = read('./PricingPage.jsx');
const layout = read('../../components/layout/PublicLayout.jsx');
const kit = css.slice(css.indexOf('/* Marketing kit */'));

test('icon tiles are glossy with a tone glow, and cards carry a matching icon watermark', () => {
  assert.match(cta, /'mkt-icon-well relative mb-5/);
  assert.match(cta, /export function MktCard\(\{ children, className, accent, icon: Icon \}\)/);
  assert.match(cta, /mkt-card-watermark/);
  for (const name of ['.mkt-icon-well::before', '.mkt-card-watermark']) {
    assert.ok(kit.includes(name), `${name} styled`);
  }
  assert.match(kit, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mkt-card-watermark/);
});

test('icon cards pass their icon to the card watermark', () => {
  assert.ok((home.match(/<MktCard accent=\{item\.accent\} icon=\{item\.icon\}/g) || []).length >= 3, 'home audiences, pillars and modules');
  assert.match(features, /<MktCard accent=\{item\.accent\} icon=\{item\.icon\}/);
  assert.match(about, /<MktCard icon=\{item\.icon\}/);
});

test('home lists use a meaningful icon per line instead of a plain check', () => {
  assert.match(home, /const heroPoints = \[\n  \{ icon:/);
  assert.match(home, /const checks = \[\n  \{ icon:/);
  assert.match(home, /const stats = \[\n  \{ icon:/);
  assert.doesNotMatch(home, /<Check /);
});

test('pricing features and FAQ questions get their own icons', () => {
  assert.match(pricing, /function featureIcon\(feature\)/);
  assert.match(pricing, /const FeatureIcon = featureIcon\(feature\)/);
  assert.match(pricing, /const faqs = \[\n  \{ icon:/);
});

test('about timeline steps and footer links show icons', () => {
  assert.match(about, /const milestones = \[\n  \{ icon:/);
  assert.match(layout, /const FOOTER_LINKS = \{/);
  assert.match(layout, /<link\.icon className=/);
});
