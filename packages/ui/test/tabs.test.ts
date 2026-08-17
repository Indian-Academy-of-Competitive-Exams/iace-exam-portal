import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tabs = readFileSync(
  path.resolve(import.meta.dirname, '..', 'src/components/ui/tabs.tsx'),
  'utf8',
);

describe('Tabs', () => {
  /** No native tab element exists, so the whole pattern is ARIA that Radix owns. */
  it('is the Radix primitive, not a row of buttons that swap a div', () => {
    assert.match(tabs, /@radix-ui\/react-tabs/);
    assert.match(tabs, /TabsPrimitive\.List/);
    assert.match(tabs, /TabsPrimitive\.Trigger/);
    assert.match(tabs, /TabsPrimitive\.Content/);
  });

  /** Colour alone fails a reader who cannot separate the two text colours. */
  it('marks the active tab with a border as well as a colour', () => {
    assert.match(tabs, /data-\[state=active\]:border-primary/);
    assert.match(tabs, /data-\[state=active\]:text-foreground/);
  });
});
