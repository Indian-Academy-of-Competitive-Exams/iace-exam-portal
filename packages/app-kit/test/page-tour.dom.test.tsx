import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@iace/ui';
import { TourProvider, TourTrigger, usePageTour } from '../browser/page-tour';
import { type KeyValueStorage, type TourStep } from '../src';
import { fakeStorage } from './support/fake-storage';

const KEY = 'iace.test.tours';

/** Which targets have a size. jsdom has no layout, so an absent entry measures 0x0 — which is also the real case a hidden control presents. */
const BOXES = new Map<string, { top: number; left: number; width: number; height: number }>();

before(() => {
  Element.prototype.getBoundingClientRect = function boxOf(this: Element): DOMRect {
    const box = BOXES.get(this.getAttribute('data-tour') ?? '');
    return new DOMRect(box?.left ?? 0, box?.top ?? 0, box?.width ?? 0, box?.height ?? 0);
  };
});

afterEach(() => {
  cleanup();
  BOXES.clear();
});

function measurable(...targets: readonly string[]) {
  for (const target of targets) BOXES.set(target, { top: 80, left: 20, width: 240, height: 40 });
}

const STEPS: readonly TourStep[] = [
  { target: 'list', title: 'Your tests', body: 'Every test the institute has opened to you.' },
  { target: 'begin', title: 'Begin', body: 'Opens the instructions, not the paper.' },
];

function Page({
  ready = true,
  steps = STEPS,
}: Readonly<{ ready?: boolean; steps?: readonly TourStep[] }>) {
  usePageTour({ id: 'tests', steps, ready });
  return (
    <>
      <div data-tour="list">rows</div>
      <div data-tour="begin">begin</div>
    </>
  );
}

/** A second screen with a tour of its own, for the route-swap case. */
function OtherPage() {
  usePageTour({
    id: 'next-page',
    steps: [{ target: 'other', title: 'Somewhere else', body: 'A different screen entirely.' }],
    ready: true,
  });
  return <div data-tour="other">other</div>;
}

function InlinePage() {
  usePageTour({
    id: 'tests',
    steps: [{ target: 'list', title: 'Your tests', body: 'Every test opened to you.' }],
    ready: true,
  });
  return <div data-tour="list">rows</div>;
}

function shell(storage: KeyValueStorage, page: React.ReactNode) {
  return (
    <TooltipProvider>
      <TourProvider storage={storage} storageKey={KEY}>
        <TourTrigger />
        {page}
      </TourProvider>
    </TooltipProvider>
  );
}

describe('usePageTour auto-firing', () => {
  it('opens on a first visit, once the screen is ready', () => {
    measurable('list', 'begin');
    render(shell(fakeStorage(), <Page />));

    assert.ok(screen.getByText('Your tests'));
    assert.ok(screen.getByText('1 of 2'));
  });

  it('stays shut on a screen this device has already been shown', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    storage.setItem(KEY, JSON.stringify(['tests']));

    render(shell(storage, <Page />));

    assert.equal(screen.queryByText('Your tests'), null);
  });

  it('waits for the screen, then opens when it is ready', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    const { rerender } = render(shell(storage, <Page ready={false} />));
    assert.equal(screen.queryByText('Your tests'), null);

    rerender(shell(storage, <Page ready />));

    assert.ok(screen.getByText('Your tests'));
  });

  /** The id is marked when the tour OPENS, so a skip is an answer rather than a question asked again. */
  it('marks the tour seen the moment it opens', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();

    render(shell(storage, <Page />));

    assert.equal(storage.getItem(KEY), JSON.stringify(['tests']));
  });

  it('does not reopen after a skip, however the screen re-renders', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    const { rerender } = render(shell(storage, <Page />));
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    assert.equal(screen.queryByText('Your tests'), null);

    rerender(shell(storage, <Page steps={[...STEPS]} />));

    assert.equal(screen.queryByText('Your tests'), null);
  });

  /** A control that measures nothing is one nobody can see pointed at. */
  it('drops a step whose target has no size', () => {
    measurable('list');

    render(shell(fakeStorage(), <Page />));

    assert.ok(screen.getByText('Your tests'));
    assert.ok(screen.getByText('1 of 1'));
  });

  it('opens nothing, and marks nothing, when no step has a target to point at', () => {
    const storage = fakeStorage();

    render(shell(storage, <Page />));

    assert.equal(screen.queryByText('Your tests'), null);
    assert.equal(storage.getItem(KEY), null);
  });

  it('opens on a later visit once the targets are there', () => {
    const storage = fakeStorage();
    const first = render(shell(storage, <Page />));
    assert.equal(screen.queryByText('Your tests'), null);
    first.unmount();

    measurable('list', 'begin');
    render(shell(storage, <Page />));

    assert.ok(screen.getByText('Your tests'));
  });

  /** Every SPA mounts under StrictMode, which runs each effect twice — the tour must survive being torn down and re-run. */
  it('opens once under StrictMode, and stays open', () => {
    measurable('list', 'begin');

    render(<StrictMode>{shell(fakeStorage(), <Page />)}</StrictMode>);

    assert.ok(screen.getByText('Your tests'));
    assert.equal(screen.getAllByText('Your tests').length, 1);
  });

  /** A screen writing its steps inline hands a new array on every render; that must not re-register and close what it opened. */
  it('opens for a screen whose steps are built inline', () => {
    measurable('list', 'begin');

    render(shell(fakeStorage(), <InlinePage />));

    assert.ok(screen.getByText('Your tests'));
  });

  /** A route swap batches the old screen's unregister with the new one's, so the id never commits as null. */
  it('closes an open tour when another screen takes over', () => {
    measurable('list', 'begin', 'other');
    const storage = fakeStorage();
    storage.setItem(KEY, JSON.stringify(['next-page']));
    const { rerender } = render(shell(storage, <Page />));
    assert.ok(screen.getByText('Your tests'));

    rerender(shell(storage, <OtherPage />));

    assert.equal(screen.queryByText('Your tests'), null);
  });

  /** A control with no width is one nobody can see pointed at, whatever its height. */
  it('drops a step whose target has width but no height', () => {
    BOXES.set('list', { top: 80, left: 20, width: 240, height: 0 });
    BOXES.set('begin', { top: 80, left: 20, width: 240, height: 40 });

    render(shell(fakeStorage(), <Page />));

    assert.ok(screen.getByText('Begin'));
    assert.ok(screen.getByText('1 of 1'));
  });

  it('closes an open tour when the screen it belongs to leaves', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    const { rerender } = render(shell(storage, <Page />));
    assert.ok(screen.getByText('Your tests'));

    rerender(shell(storage, null));

    assert.equal(screen.queryByText('Your tests'), null);
  });
});

describe('TourTrigger', () => {
  it('is absent on a screen that registered no tour', () => {
    render(shell(fakeStorage(), <div>plain</div>));

    assert.equal(screen.queryByRole('button', { name: 'Tour this page' }), null);
  });

  it('is present on a screen that has one', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    storage.setItem(KEY, JSON.stringify(['tests']));

    render(shell(storage, <Page />));

    assert.ok(screen.getByRole('button', { name: 'Tour this page' }));
  });

  it('replays a tour the reader has already been shown', () => {
    measurable('list', 'begin');
    const storage = fakeStorage();
    storage.setItem(KEY, JSON.stringify(['tests']));
    render(shell(storage, <Page />));

    fireEvent.click(screen.getByRole('button', { name: 'Tour this page' }));

    assert.ok(screen.getByText('Your tests'));
  });
});

describe('a step that moves', () => {
  it('follows its target when the window is resized', () => {
    measurable('list', 'begin');
    render(shell(fakeStorage(), <Page />));
    assert.equal(document.querySelector<HTMLElement>('[data-tour-cutout]')?.style.top, '80px');

    BOXES.set('list', { top: 300, left: 20, width: 240, height: 40 });
    fireEvent(window, new Event('resize'));

    assert.equal(document.querySelector<HTMLElement>('[data-tour-cutout]')?.style.top, '300px');
  });
});
