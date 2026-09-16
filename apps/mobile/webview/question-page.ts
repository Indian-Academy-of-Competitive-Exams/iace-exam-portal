/**
 * The page inside QuestionContent's WebView — browser code, bundled by
 * build.mjs and never by Metro. It draws the screen native hands it and posts
 * what the student did; it never decides what is selected. Every authored
 * string reaches the DOM through the web's own `richHtml`, and nothing else.
 */
import { richHtml } from '../../../packages/ui/src/lib/rich-html';
import {
  PAGE_MESSAGE,
  SHOW_QUESTION,
  type PageMessage,
  type QuestionScreen,
  type ScreenContent,
  type ScreenOption,
} from '../src/components/exam/question-bridge';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

/** FillBubble's timings, so a bubble fills at the same pace on both clients. */
const HOLD_MS = 900;
const MIN_HOLD_MS = 200;
const FULL = 1;

const OPTION = 'option';
const BUBBLE = 'bubble';

interface Hold {
  optionId: string;
  bubble: HTMLElement;
  from: number;
  reached: number;
  began: number;
  frame: number;
}

const root = document.createElement('main');
root.className = 'question';
document.body.append(root);

let current: QuestionScreen | null = null;
let drawnContent = '';
let hold: Hold | null = null;

const post = (message: PageMessage): void =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));

function element(tag: string, className: string): HTMLElement {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function richBlocks(blocks: readonly ScreenContent[]): HTMLElement[] {
  return blocks.map(({ lang, html }) => {
    const block = element('div', 'rich-content');
    block.lang = lang;
    block.innerHTML = richHtml(html);
    return block;
  });
}

function ink(bubble: HTMLElement, fill: number): void {
  bubble.style.setProperty('--fill', String(fill));
  bubble.toggleAttribute('data-inked', fill > 0);
  bubble.toggleAttribute('data-full', fill >= FULL);
  bubble.setAttribute('aria-checked', String(fill >= FULL));
}

function build(screen: QuestionScreen): void {
  const stem = element('section', 'stem');
  stem.append(...richBlocks(screen.stem));

  const options = element('ol', 'options');
  options.setAttribute('role', 'radiogroup');
  screen.options.forEach((option, position) => {
    const letter = String.fromCodePoint(65 + position);
    const row = element('div', OPTION);
    row.dataset.optionId = option.id;

    const control = element('span', screen.bubbling ? BUBBLE : 'radio');
    if (screen.bubbling) {
      control.setAttribute('role', 'radio');
      control.setAttribute('aria-label', letter);
    } else {
      row.setAttribute('role', 'radio');
    }

    const label = element('span', 'letter');
    label.textContent = letter;
    const texts = element('span', 'texts');
    texts.append(...richBlocks(option.content));

    row.append(control, label, texts);
    const item = document.createElement('li');
    item.append(row);
    options.append(item);
  });

  root.replaceChildren(stem, options);
  window.scrollTo(0, 0);
}

function paint(screen: QuestionScreen): void {
  for (const row of root.querySelectorAll<HTMLElement>(`.${OPTION}`)) {
    const option = screen.options.find(({ id }) => id === row.dataset.optionId);
    const selected = option?.id === screen.selectedOptionId;
    row.toggleAttribute('data-selected', selected);
    const bubble = row.querySelector<HTMLElement>(`.${BUBBLE}`);
    if (bubble) {
      ink(bubble, option?.fill ?? 0);
      bubble.setAttribute('aria-disabled', String(screen.locked));
    } else {
      row.setAttribute('aria-checked', String(selected));
    }
  }
}

function show(screen: QuestionScreen): void {
  if (hold) cancelAnimationFrame(hold.frame);
  hold = null;
  current = screen;
  document.body.dataset.examTemplate = screen.template;
  const content = JSON.stringify([
    screen.bubbling,
    screen.stem,
    screen.options.map((o) => [o.id, o.content]),
  ]);
  if (content !== drawnContent) {
    build(screen);
    drawnContent = content;
  }
  paint(screen);
}

// Committed the moment it fills rather than on release: the student sees the ink take.
function tick(now: number): void {
  if (!hold) return;
  hold.reached = Math.min(FULL, hold.from + (now - hold.began) / HOLD_MS);
  ink(hold.bubble, hold.reached);
  if (hold.reached < FULL) {
    hold.frame = requestAnimationFrame(tick);
    return;
  }
  const { optionId } = hold;
  hold = null;
  post({ type: PAGE_MESSAGE.BUBBLE, optionId, fill: FULL });
}

function release(): void {
  if (!hold) return;
  cancelAnimationFrame(hold.frame);
  const { optionId, from, reached } = hold;
  hold = null;
  // Under the floor it was a tap, not a hold: back to native's ink, and nothing reported.
  if ((reached - from) * HOLD_MS < MIN_HOLD_MS) {
    if (current) paint(current);
    return;
  }
  post({ type: PAGE_MESSAGE.BUBBLE, optionId, fill: reached });
}

const optionIdOf = (target: EventTarget | null): string | undefined =>
  target instanceof Element
    ? target.closest<HTMLElement>(`.${OPTION}`)?.dataset.optionId
    : undefined;

root.addEventListener('click', (event) => {
  const optionId = optionIdOf(event.target);
  if (current && !current.bubbling && optionId) post({ type: PAGE_MESSAGE.CHOOSE, optionId });
});

const inkable = (option: ScreenOption | undefined): option is ScreenOption =>
  option !== undefined && current?.locked === false && option.fill < FULL;

root.addEventListener('pointerdown', (event) => {
  const bubble =
    event.target instanceof Element ? event.target.closest<HTMLElement>(`.${BUBBLE}`) : null;
  const optionId = optionIdOf(bubble);
  const option = current?.options.find(({ id }) => id === optionId);
  if (!bubble || hold || !inkable(option)) return;
  // Captured so a scribble that wanders off the circle keeps filling instead of committing.
  bubble.setPointerCapture(event.pointerId);
  hold = {
    optionId: option.id,
    bubble,
    from: option.fill,
    reached: option.fill,
    began: performance.now(),
    frame: requestAnimationFrame(tick),
  };
});

root.addEventListener('pointerup', release);
root.addEventListener('pointercancel', release);
document.addEventListener('contextmenu', (event) => event.preventDefault());

Object.assign(window, { [SHOW_QUESTION]: show });
post({ type: PAGE_MESSAGE.READY });
