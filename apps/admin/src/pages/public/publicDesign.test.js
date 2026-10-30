import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const pages = {
  home: read('./HomePage.jsx'),
  features: read('./FeaturesPage.jsx'),
  pricing: read('./PricingPage.jsx'),
  about: read('./AboutPage.jsx'),
  contact: read('./ContactPage.jsx'),
  demo: read('./DemoRequestPage.jsx'),
  legal: read('./LegalPage.jsx'),
};
const kit = read('../../components/marketing/MktKit.jsx');
const css = read('../../index.css');
const layout = read('../../components/layout/PublicLayout.jsx');

test('every public page uses the shared marketing kit for its hero and section titles', () => {
  for (const [name, source] of Object.entries(pages)) {
    assert.match(source, /from '\.\.\/\.\.\/components\/marketing\/MktKit'/, `${name} imports MktKit`);
    assert.match(source, /<PageHero|<HomeHero/, `${name} has a designed hero`);
  }
  for (const name of ['home', 'features', 'pricing', 'about', 'contact']) {
    assert.match(pages[name], /<SectionHeading/, `${name} uses SectionHeading`);
    assert.match(pages[name], /<Reveal/, `${name} reveals on scroll`);
  }
});

test('the kit ships scroll reveal, spotlight cards, count-up and a channel marquee', () => {
  for (const name of ['Reveal', 'SectionHeading', 'PageHero', 'SpotlightCard', 'CountUp', 'ChannelMarquee']) {
    assert.match(kit, new RegExp(`export function ${name}\\b`));
  }
  assert.match(kit, /IntersectionObserver/);
  assert.match(kit, /prefers-reduced-motion/);
});

test('motion classes stand still for people who ask for reduced motion', () => {
  const block = css.slice(css.indexOf('/* Marketing kit */'));
  assert.ok(block.length > 20, 'marketing kit css block exists');
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reveal[\s\S]*opacity: 1/);
  assert.match(block, /\.mkt-marquee-track/);
  assert.match(block, /\.mkt-spotlight/);
});

test('the header reacts to scroll inside #root, which is the real scroll container', () => {
  assert.match(css, /#root \{[^}]*overflow-x: hidden/);
  assert.match(layout, /scrolled/);
  assert.match(layout, /addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\)/);
  assert.match(layout, /getElementById\('root'\)/);
});

test('home hero fills the first screen on desktop so the channel marquee is visible without scrolling', () => {
  const hero = pages.home.slice(pages.home.indexOf('function HomeHero'), pages.home.indexOf('export default function HomePage'));
  assert.match(hero, /<section className="[^"]*lg:min-h-\[calc\(100dvh-72px\)\][^"]*lg:flex-col/);
  assert.match(hero, /lg:flex-1/);
  assert.doesNotMatch(hero, /sm:pb-24 sm:pt-20/, 'desktop hero padding no longer pushes the marquee below the fold');
  assert.match(hero, /Orders flow in from[\s\S]*<ChannelMarquee/);
});

test('home hero right side is a larger image slider that tells the order story step by step', () => {
  const hero = pages.home.slice(pages.home.indexOf('function HomeHero'), pages.home.indexOf('export default function HomePage'));
  assert.match(hero, /<HeroShowcase \/>/);
  assert.doesNotMatch(hero, /<OpsPreview \/>/);

  const slides = pages.home.slice(pages.home.indexOf('const heroSlides = ['), pages.home.indexOf('function HeroShowcase'));
  const images = slides.match(/image: 'home-hero-[a-z-]+'/g) || [];
  assert.ok(images.length >= 5, 'five story slides');
  for (const text of ['68798-LEH', 'Reserved · WH-001', 'vendor', 'Delhivery', 'GST']) {
    assert.ok(slides.includes(text), `a slide explains ${text}`);
  }

  const showcase = pages.home.slice(pages.home.indexOf('function HeroShowcase'), pages.home.indexOf('function HomeHero'));
  assert.match(showcase, /<MktImage[\s\S]*?name=\{slide\.image\}/);
  assert.match(showcase, /lg:-mr-8/, 'image is wider than the old 84% column');
  assert.match(showcase, /aspect-\[6\/5\]/);
  assert.match(showcase, /lg:\[@media\(max-height:760px\)\]:aspect-\[4\/3\]/, 'image shortens on short screens so the marquee stays visible');
  assert.match(showcase, /setInterval\(/, 'slides advance on their own');
  assert.match(showcase, /prefers-reduced-motion: reduce/, 'no autoplay for reduced motion');
  assert.match(showcase, /onMouseEnter=\{\(\) => setPaused\(true\)\}/, 'hover pauses the slider');
  assert.match(showcase, /onTouchStart=/, 'swipe on phones');
  assert.match(showcase, /aria-label=\{`Show slide \$\{index \+ 1\}: \$\{item\.title\}`\}/);
  assert.match(showcase, /aria-current=\{index === active/);
  assert.match(showcase, /aria-label="Previous slide"/);
  assert.match(showcase, /aria-label="Next slide"/);
});

test('public titles use a display font, scoped to the marketing site only', () => {
  const html = read('../../../index.html');
  assert.match(html, /family=Plus\+Jakarta\+Sans:wght@[^"&]*800/);
  const block = css.slice(css.indexOf('/* Marketing kit */'));
  assert.match(block, /\.marketing-site :is\(h1, h2, h3, h4\) \{[^}]*font-family: 'Plus Jakarta Sans'/);
  assert.doesNotMatch(css.slice(0, css.indexOf('/* Marketing kit */')), /Plus Jakarta Sans/, 'admin screens keep Inter');
});

test('section titles put the gradient highlight on its own line from sm up', () => {
  const heading = kit.slice(kit.indexOf('export function SectionHeading'), kit.indexOf('export function HeroBackdrop'));
  assert.match(heading, /<span className=\{cn\('sm:block', dark \? 'mkt-gradient-text-light' : 'mkt-gradient-text'\)\}>\{highlight\}<\/span>/);
});

test('brand mark has a gradient wordmark, optional tagline and a dark variant', () => {
  const brand = read('../../components/marketing/BrandMark.jsx');
  assert.match(brand, /export default function BrandMark\(\{[^}]*tagline[^}]*dark = false/);
  assert.match(brand, /mkt-brand-mark/);
  assert.match(brand, /mkt-brand-word/);
  assert.match(brand, /dark \? 'mkt-gradient-text-light' : 'mkt-gradient-text'/);
  assert.match(brand, /Multichannel OMS/);
});

test('header nav is a pill bar with an active pill, a gradient top line and a floating island on scroll', () => {
  assert.match(layout, /className="mkt-nav /);
  assert.match(layout, /mkt-nav-pill/);
  assert.match(layout, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(layout, /mkt-header-line/);
  assert.match(layout, /lg:rounded-2xl/);
  assert.match(layout, /<BrandMark tagline \/>/);
  assert.match(layout, /<BrandMark dark tagline \/>/);
  assert.doesNotMatch(layout, /\[&_\.text-emerald-600\]:text-emerald-300/, 'drawer uses the dark variant instead of a class override');
  const block = css.slice(css.indexOf('/* Marketing kit */'));
  for (const name of ['.mkt-nav-pill.is-active', '.mkt-brand-mark', '.mkt-brand-word', '.mkt-header-line']) {
    assert.ok(block.includes(name), `${name} styled`);
  }
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mkt-header-line/);
});

test('mobile drawer scrolls as a whole so every menu link stays reachable on short screens', () => {
  assert.match(layout, /<aside className="mkt-drawer overflow-y-auto"/);
  assert.doesNotMatch(layout, /<nav className="flex-1 overflow-y-auto/);
  assert.match(layout, /className="mkt-hero relative isolate shrink-0 overflow-hidden/, 'drawer header keeps its height');
  assert.match(layout, /className="shrink-0 border-t border-slate-100 px-3 py-3"/, 'legal block keeps its height');
  assert.match(layout, /className="mt-auto shrink-0 space-y-3/, 'contact block keeps its height');
});

test('pricing and about no longer carry outdated product facts', () => {
  assert.doesNotMatch(pages.pricing, /Launch channels|'23'|launch channels/);
  assert.doesNotMatch(pages.about, /Live JWT \+ inventory ledger|Clickable UI for every module/);
});
