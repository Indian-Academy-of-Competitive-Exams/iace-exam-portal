import { JSDOM } from 'jsdom';

/**
 * A DOM for the component tests, installed by `--import` before any test loads.
 *
 * jsdom's classes must WIN over Node's own `Event`/`CustomEvent`, or a library
 * that constructs one and dispatches it on an element gets "parameter 1 is not
 * of type 'Event'" — jsdom checks the brand, and Node's global is a different
 * implementation. So the window is copied over the top, minus the Node globals
 * below that the test runner itself depends on.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const win = dom.window as unknown as Window & typeof globalThis;

/** Node's, not jsdom's: `node:test` mock timers patch these on globalThis. */
const KEEP_NODE = new Set([
  'process',
  'Buffer',
  'global',
  'globalThis',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'fetch',
  'performance',
]);

function define(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith('_') || KEEP_NODE.has(key)) continue;
  try {
    define(key, (win as unknown as Record<string, unknown>)[key]);
  } catch {
    // A few window properties are getters that only make sense on the window.
  }
}

define('window', win);
define('document', win.document);

/**
 * Radix measures and observes; jsdom has neither. Nothing under test reads a
 * size, so the stub records the calls rather than being three empty bodies.
 */
class StubResizeObserver {
  readonly observed = new Set<Element>();

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }
}
define('ResizeObserver', StubResizeObserver);

const CHART_WIDTH = 800;
const CHART_HEIGHT = 320;
const measure = win.Element.prototype.getBoundingClientRect;

/** jsdom has no layout, and Recharts draws nothing at all inside a box of zero. */
win.Element.prototype.getBoundingClientRect = function boxOf(this: Element): DOMRect {
  const box = measure.call(this);
  if (box.width > 0 || !this.classList.contains('recharts-wrapper')) return box;
  const declared = Number(this.getAttribute('height'));
  return new win.DOMRect(0, 0, CHART_WIDTH, declared > 0 ? declared : CHART_HEIGHT);
};

win.Element.prototype.scrollIntoView = () => {};
win.HTMLElement.prototype.hasPointerCapture = () => false;
win.HTMLElement.prototype.releasePointerCapture = () => {};
win.HTMLElement.prototype.setPointerCapture = () => {};

if (!('matchMedia' in globalThis)) {
  define('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** Tells React that updates are wrapped in `act`, so a missing one is an error. */
define('IS_REACT_ACT_ENVIRONMENT', true);
