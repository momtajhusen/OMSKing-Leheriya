import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_IMAGES, IMAGE_SIZES, imagePrompt, imageSources } from '../../constants/marketingImages.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const component = read('./MktImage.jsx');
const pages = {
  Home: read('../../pages/public/HomePage.jsx'),
  Features: read('../../pages/public/FeaturesPage.jsx'),
  Pricing: read('../../pages/public/PricingPage.jsx'),
  Demo: read('../../pages/public/DemoRequestPage.jsx'),
  About: read('../../pages/public/AboutPage.jsx'),
  Contact: read('../../pages/public/ContactPage.jsx'),
  Login: read('../layout/AuthLayout.jsx'),
};
const names = Object.keys(MARKETING_IMAGES);

test('every image slot has a clear file name, a ChatGPT size and a page section', () => {
  assert.ok(names.length >= 18, 'enough images to cover every public page');
  for (const name of names) {
    const spec = MARKETING_IMAGES[name];
    assert.match(name, /^(home|features|pricing|demo|about|contact|login)-[a-z0-9-]+$/, `${name} is page-prefixed kebab-case`);
    assert.ok(IMAGE_SIZES[spec.size], `${name} uses a ChatGPT size`);
    assert.ok(spec.page && spec.section && spec.alt && spec.scene, `${name} has page, section, alt and scene`);
  }
  for (const size of Object.values(IMAGE_SIZES)) {
    assert.ok([[1536, 1024], [1024, 1024], [1024, 1536]].some(([w, h]) => w === size.width && h === size.height));
  }
});

test('each prompt names the file, the size, the section, the brand colours and forbids text', () => {
  for (const name of names) {
    const prompt = imagePrompt(name);
    const size = IMAGE_SIZES[MARKETING_IMAGES[name].size];
    assert.ok(prompt.startsWith(`Image name: ${name}.png`), `${name} prompt starts with its file name`);
    assert.ok(prompt.includes(`${size.width} × ${size.height} px`), `${name} prompt has its size`);
    assert.ok(prompt.includes(MARKETING_IMAGES[name].section), `${name} prompt names its section`);
    assert.match(prompt, /#0D5C45/);
    assert.match(prompt, /no text, letters, numbers, logos/i);
  }
});

test('an image file is looked up as png, then webp, then jpg under /marketing', () => {
  assert.deepEqual(imageSources('home-order-desk'), [
    '/marketing/home-order-desk.png',
    '/marketing/home-order-desk.webp',
    '/marketing/home-order-desk.jpg',
  ]);
});

test('public pages never show prompts or copy buttons; a missing image gets a quiet fallback', () => {
  assert.doesNotMatch(component, /Copy prompt|View prompt|imagePrompt|navigator\.clipboard|PromptSlot/);
  assert.doesNotMatch(component, /import\.meta\.env\.DEV/);
  const fallback = component.slice(component.indexOf('mkt-image-fallback'));
  assert.match(fallback, /data-image-label/);
  assert.match(fallback, /\{name\}\.png/);
  assert.match(fallback, /\{size\.width\} × \{size\.height\} px/);
  assert.match(fallback, /\{size\.label\}/);
  assert.match(component, /loading=\{priority \? 'eager' : 'lazy'\}/);
  assert.match(component, /width=\{size\.width\}/);
});

test('every catalog image is placed on its page, and every public page has images', () => {
  for (const name of names) {
    const page = pages[MARKETING_IMAGES[name].page];
    assert.ok(page, `${name} maps to a known page`);
    assert.ok(page.includes(`name="${name}"`) || page.includes(`'${name}'`), `${name} is placed on the ${MARKETING_IMAGES[name].page} page`);
  }
  for (const [page, source] of Object.entries(pages)) {
    assert.match(source, /<MktImage/, `${page} renders MktImage`);
  }
});
