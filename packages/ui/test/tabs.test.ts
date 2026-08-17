import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tabs = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/tabs.tsx'),
  'utf8',
);

describe('Tabs', () => {
  /**
   * There is no native tab element, so the entire pattern is ARIA: the tablist
   * role, arrow keys between tabs, each panel wired to the tab that owns it,
   * and only the active tab in the page's tab order so Tab moves INTO the
   * panel. Hand-built tabs are a row of buttons swapping a div — identical on
   * screen, and silent to anything that is not looking at it.
   */
  it('is the Radix primitive, not a row of buttons that swap a div', () => {
    assert.match(tabs, /@radix-ui\/react-tabs/);
    assert.match(tabs, /TabsPrimitive\.List/);
    assert.match(tabs, /TabsPrimitive\.Trigger/);
    assert.match(tabs, /TabsPrimitive\.Content/);
  });

  /**
   * The brand is red and the active tab is brand-coloured, so colour alone
   * would leave the current section indistinguishable to a reader who cannot
   * separate the two text colours. The border carries it as well.
   */
  it('marks the active tab with a border as well as a colour', () => {
    assert.match(tabs, /data-\[state=active\]:border-primary/);
    assert.match(tabs, /data-\[state=active\]:text-foreground/);
  });
});
