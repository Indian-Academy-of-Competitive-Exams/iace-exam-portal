import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const menu = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/dropdown-menu.tsx'),
  'utf8',
);
const userMenu = readFileSync(
  path.resolve(REPO_ROOT, 'packages/app-kit/browser/app-shell/user-menu.tsx'),
  'utf8',
);

describe('DropdownMenu', () => {
  /** `hover:` alone leaves the keyboard selection moving with nothing following it. */
  it('styles the highlight, not just the hover', () => {
    assert.match(menu, /data-\[highlighted\]:bg-muted/);
    assert.match(menu, /data-\[highlighted\]:bg-destructive\/10/);
    assert.ok(!/hover:bg-muted/.test(menu), 'hover alone would miss the keyboard');
  });
});

describe('the user menu', () => {
  /** A popover announces no item count and no position, and ignores the arrow keys. */
  it('is a menu rather than a popover full of links', () => {
    assert.ok(!/react-popover/.test(userMenu), 'the account menu must not be a bare popover');
    assert.match(userMenu, /<DropdownMenuItem/);
  });

  /** An <a href> reloads the SPA and throws away the query cache. */
  it('navigates with the router, not with the browser', () => {
    assert.match(userMenu, /<DropdownMenuItem key=\{entry\.label\} asChild>\s*<Link/);
  });
});
