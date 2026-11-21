import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const sidebar = fs.readFileSync(new URL('./AdminSidebar.jsx', import.meta.url), 'utf8');

test('mobile side menu opens fast and above header + bottom nav', () => {
  // Must not use a soft spring — that feels laggy on phone.
  assert.doesNotMatch(
    sidebar,
    /transition=\{\{\s*type:\s*'spring',\s*damping:\s*25,\s*stiffness:\s*200\s*\}\}/
  );
  assert.match(sidebar, /type:\s*'tween'/);
  assert.match(sidebar, /duration:\s*0\.1[5-8]/);

  // Bottom nav is z-index 60; menu + scrim must sit above it and the sticky header.
  assert.match(sidebar, /fixed inset-0 z-\[70\].*lg:hidden|z-\[70\].*fixed inset-0/);
  assert.match(sidebar, /fixed[^"']*z-\[70\][^"']*lg:hidden|z-\[70\][^"']*lg:hidden/);

  // Full height from the top — do not leave a hole for the bottom tabs.
  assert.doesNotMatch(
    sidebar,
    /pb-\[calc\(4\.75rem\+env\(safe-area-inset-bottom\)\)\].*lg:hidden|lg:hidden[^"']*pb-\[calc\(4\.75rem/
  );
  assert.match(sidebar, /inset-y-0|top-0/);
});
