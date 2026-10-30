import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const layout = read('../../components/layout/AuthLayout.jsx');
const login = read('./LoginPage.jsx');
const css = read('../../index.css');

test('login opens as a split screen with a dark brand panel on desktop', () => {
  assert.match(layout, /if \(isLogin\)/);
  assert.match(layout, /lg:grid-cols-\[/);
  assert.match(layout, /<aside className="mkt-hero [^"]*lg:sticky lg:top-0 lg:h-dvh lg:self-start/, 'brand panel stays a full screen while the form scrolls');
  assert.match(layout, /\[@media\(max-height:780px\)\]:hidden/, 'floating cards step aside on short screens');
  assert.match(layout, /<HeroBackdrop \/>/);
  assert.match(layout, /<BrandMark dark tagline \/>/);
  assert.match(layout, /<ChannelMarquee items=\{CHANNEL_DOTS\} dark \/>/);
  assert.match(layout, /auth-split/);
  assert.match(css.slice(css.indexOf('/* Marketing kit */')), /\.auth-split :is\(h1, h2\)/);
});

test('the login form keeps every legal link reachable on the split screen too', () => {
  const start = layout.indexOf('if (isLogin)');
  const loginBranch = layout.slice(start, layout.indexOf('\n  return (', start));
  assert.match(loginBranch, /LEGAL_LINKS\.map/);
});

test('login card has a password toggle, focus rings, a shining submit and a tenant note', () => {
  assert.match(login, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(login, /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/);
  assert.match(login, /aria-pressed=\{showPassword\}/);
  assert.ok((login.match(/mkt-field/g) || []).length >= 2, 'email and password inputs use the focus ring');
  assert.match(login, /mkt-cta-solid/);
  assert.match(login, /only your company/);
});

test('login logic is unchanged: same endpoints and the 2FA step', () => {
  assert.match(login, /api\.post\('\/auth\/login', values\)/);
  assert.match(login, /api\.post\('\/auth\/verify-login', \{ \.\.\.twoFactor, otp: parsed\.data\.otp \}\)/);
  assert.match(login, /<CompanyChoice /);
});
