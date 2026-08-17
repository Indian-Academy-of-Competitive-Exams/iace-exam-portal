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
  /**
   * Radix moves `data-highlighted` with the arrow keys as well as the pointer.
   * Styling `hover:` alone leaves a menu that looks inert to anyone driving it
   * from the keyboard — the selection moves and nothing on screen follows it.
   */
  it('styles the highlight, not just the hover', () => {
    assert.match(menu, /data-\[highlighted\]:bg-muted/);
    assert.match(menu, /data-\[highlighted\]:bg-destructive\/10/);
    assert.ok(!/hover:bg-muted/.test(menu), 'hover alone would miss the keyboard');
  });
});

describe('the user menu', () => {
  /**
   * It was a Popover holding a column of links. That closed on Escape and on a
   * click outside, so it was not broken — but a popover is an anonymous box: it
   * announces no item count and no position within the list, and the arrow keys
   * do nothing inside it. A list of choices should say that it is one.
   */
  it('is a menu rather than a popover full of links', () => {
    assert.ok(!/react-popover/.test(userMenu), 'the account menu must not be a bare popover');
    assert.match(userMenu, /<DropdownMenuItem/);
  });

  /**
   * An <a href> reloads the SPA, throwing away the query cache to move between
   * two screens of the same app. `asChild` is what lets a router Link be the
   * menu item without Radix losing the keyboard behaviour.
   */
  it('navigates with the router, not with the browser', () => {
    assert.match(userMenu, /<DropdownMenuItem key=\{entry\.label\} asChild>\s*<Link/);
  });
});
