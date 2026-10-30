import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_IMAGES, MARKETING_PAGES, imageSources, imagesByPage } from '../../constants/marketingImages.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./PlatformWebsiteImagesPage.jsx');
const router = read('../../router/index.jsx');
const layout = read('../../components/layout/PlatformLayout.jsx');
const mktImage = read('../../components/marketing/MktImage.jsx');
const store = read('../../stores/marketingImageStore.js');

test('an uploaded image is tried first, then the files bundled under /marketing', () => {
  assert.deepEqual(imageSources('home-order-desk', 'https://api.example/uploads/marketing/a.png'), [
    'https://api.example/uploads/marketing/a.png',
    '/marketing/home-order-desk.png',
    '/marketing/home-order-desk.webp',
    '/marketing/home-order-desk.jpg',
  ]);
  assert.equal(imageSources('home-order-desk', '').length, 3);
});

test('every website image appears once, grouped under its public page in site order', () => {
  assert.deepEqual(MARKETING_PAGES.map((item) => item.page), ['Home', 'Features', 'Pricing', 'Demo', 'About', 'Contact', 'Login']);
  assert.deepEqual(MARKETING_PAGES.map((item) => item.path), ['/', '/features', '/pricing', '/demo', '/about', '/contact', '/auth/login']);
  const groups = imagesByPage();
  const flat = groups.flatMap((group) => group.names);
  assert.deepEqual([...flat].sort(), Object.keys(MARKETING_IMAGES).sort());
  assert.equal(new Set(flat).size, flat.length);
  for (const group of groups) {
    for (const name of group.names) assert.equal(MARKETING_IMAGES[name].page, group.page);
  }
});

test('platform admin has a Website images page in the sidebar and router', () => {
  assert.match(layout, /\{ path: '\/platform\/website-images', label: 'Website images', icon: Images \}/);
  const platformRoutes = router.slice(router.indexOf("path: '/platform',"), router.indexOf('// Merchant OMS'));
  assert.match(platformRoutes, /path: 'website-images',[\s\S]*?<PlatformWebsiteImagesPage \/>/);
  assert.match(router, /lazy\(\(\) => import\('\.\.\/pages\/platform\/PlatformWebsiteImagesPage'\)\)/);
});

test('the page lists, uploads, replaces, captions and deletes images through the platform API', () => {
  assert.match(page, /api\.get\('\/marketing-images\/manage'\)/);
  assert.match(page, /api\.put\(`\/marketing-images\/\$\{name\}`/);
  assert.match(page, /onUploadProgress/);
  assert.match(page, /api\.patch\(`\/marketing-images\/\$\{/);
  assert.match(page, /api\.delete\(`\/marketing-images\/\$\{/);
  assert.match(page, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(page, /5 \* 1024 \* 1024/);
  assert.match(page, /onDrop=/);
  assert.match(page, /imagesByPage\(\)/);
  assert.match(page, /imagePrompt\(/);
  assert.match(page, /Copy prompt/);
  assert.match(page, /Remove this image\?/);
  assert.match(page, /aria-label=\{`\$\{uploaded \? 'Replace' : 'Upload'\} \$\{name\}`\}/);
  assert.match(page, /useMarketingImageStore/);
});

test('public pages show the uploaded image before the bundled file and the prompt card', () => {
  assert.match(store, /api\.get\('\/marketing-images'\)/);
  assert.match(store, /if \(get\(\)\.status !== 'idle'\) return/);
  assert.match(mktImage, /useMarketingImageStore/);
  assert.match(mktImage, /imageSources\(name, mediaUrl\(uploaded\?\.url\)\)/);
  assert.match(mktImage, /uploaded\?\.alt \|\| spec\.alt/);
});

test('the image frame stays clear; name, details and small icon buttons sit in a strip below it', () => {
  const card = page.slice(page.indexOf('function ImageCard'), page.indexOf('export default function PlatformWebsiteImagesPage'));
  assert.doesNotMatch(page, /View prompt|setPromptFor|onPrompt/);
  const frameAt = card.indexOf('data-image-frame={name}');
  const footerAt = card.indexOf('data-image-footer={name}');
  assert.ok(frameAt > 0 && footerAt > frameAt, 'footer strip comes after the frame');
  const frame = card.slice(frameAt, footerAt);
  const footer = card.slice(footerAt);
  assert.doesNotMatch(frame, /{name}.png|spec.section|aria-label={`/, 'nothing covers the image');
  assert.doesNotMatch(card, /absolute inset-x-0 bottom-0/);
  assert.match(footer, /{name}.png/);
  assert.match(footer, /spec.section/);
  for (const label of ['Copy prompt for ${name}', "${uploaded ? 'Replace' : 'Upload'} ${name}", 'Edit alt text for ${name}', 'Remove ${name}']) {
    assert.ok(footer.includes(`aria-label={\`${label}\`}`), `${label} is a small icon button below the frame`);
  }
  assert.match(footer, /className=\{ICON_BUTTON\}/);
  assert.match(page, /const ICON_BUTTON = '[^']*h-7 w-7/);
});

test('a pasted clipboard image is picked out of the paste event; text-only pastes are ignored', async () => {
  const { pastedImage, readClipboardImage } = await import('../../lib/clipboardImage.js');
  const png = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
  const fromItems = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
    ],
  };
  assert.equal(pastedImage(fromItems), png);
  assert.equal(pastedImage({ items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }], files: [] }), null);
  assert.equal(pastedImage({ items: [], files: [png] }), png);
  assert.equal(pastedImage({ items: [], files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] }), null);
  assert.equal(pastedImage(null), null);

  const clipboard = {
    read: async () => [
      { types: ['text/plain'], getType: async () => new Blob(['hi'], { type: 'text/plain' }) },
      { types: ['text/html', 'image/png'], getType: async (type) => new Blob([new Uint8Array([9])], { type }) },
    ],
  };
  const file = await readClipboardImage('home-order-desk', clipboard);
  assert.equal(file.name, 'home-order-desk.png');
  assert.equal(file.type, 'image/png');
  assert.equal(await readClipboardImage('home-order-desk', { read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }] }), null);
});

test('the platform page uploads a pasted image into the hovered or selected card', () => {
  assert.match(page, /document\.addEventListener\('paste', onPaste\)/);
  assert.match(page, /pastedImage\(event\.clipboardData\)/);
  assert.match(page, /readClipboardImage\(name\)/);
  assert.match(page, /aria-label=\{`Paste image into \$\{name\}`\}/);
  assert.match(page, /onMouseEnter=\{\(\) => onSelect\(name\)\}/);
  assert.match(page, /⌘V/);
  assert.match(page, /INPUT\|TEXTAREA/, 'typing in the alt text box is not hijacked');
});

test('prompts and copying live only in the platform admin page', () => {
  assert.match(page, /import \{ copyText \} from '\.\.\/\.\.\/lib\/copyText'/);
  assert.doesNotMatch(page, /components\/marketing\/MktImage/);
  const copy = read('../../lib/copyText.js');
  assert.match(copy, /execCommand\('copy'\)/);
  assert.match(copy, /navigator\.clipboard\.writeText/);
});

test('the login panel shows one large image that fills the free height, with the floating cards on its corners', () => {
  const layout = read('../../components/layout/AuthLayout.jsx');
  const panel = layout.slice(layout.indexOf('if (isLogin)'), layout.indexOf('<main'));
  assert.match(panel, /<MktImage[\s\S]*?name="login-hero"/);
  assert.match(panel, /aspectClassName="h-full w-full"/);
  assert.match(panel, /min-h-0 flex-1/);
  assert.match(panel, /panelCards\.map/);
  assert.equal(MARKETING_IMAGES['login-hero'].page, 'Login');
  assert.equal(MARKETING_IMAGES['login-hero'].size, 'landscape');
});
