import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PAGE_CONTENT_CLASS, ThemeProvider, TooltipProvider } from '@iace/ui';
import { AppShell, useWorkspace } from '../browser/app-shell';
import { type NavItem } from '../src';

afterEach(cleanup);

/**
 * jsdom's matchMedia always reports no match, and the shell renders a different
 * component per breakpoint rather than one styled twice — so a test that does
 * not pin the viewport is silently testing the mobile tree.
 */
function setDesktop(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

const NAV: readonly NavItem[] = [{ to: '/students', label: 'Students' }];

function renderShell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <MemoryRouter>
      {/* Both are mounted by AppProviders in the real app: the header's ThemeToggle reads one,
          and the rail's per-icon tooltip reads the other. */}
      <ThemeProvider>
        <TooltipProvider>
          <AppShell nav={NAV} userLabel="admin@iace.co.in" onSignOut={() => {}} {...props}>
            <p>Page</p>
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function Workspace({ immersive }: Readonly<{ immersive: boolean }>) {
  useWorkspace(immersive);
  return <p>Editor</p>;
}

function renderWorkspace(immersive: boolean) {
  setDesktop(true);
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <TooltipProvider>
          <AppShell nav={NAV} userLabel="admin@iace.co.in" onSignOut={() => {}}>
            <Workspace immersive={immersive} />
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('a workspace page', () => {
  it('keeps the chrome until the page asks for the window', () => {
    renderWorkspace(false);

    assert.ok(screen.getByRole('navigation', { name: 'Sections' }));
    assert.ok(screen.getByRole('link', { name: /IACE/ }));
  });

  /** What full screen is FOR: nothing on the glass but the work and the bar that drives it. */
  it('takes the rail and the branding away while immersive', () => {
    renderWorkspace(true);

    assert.equal(screen.queryByRole('navigation', { name: 'Sections' }) === null, true);
    assert.equal(screen.queryByRole('link', { name: /IACE/ }) === null, true);
    assert.ok(screen.getByText('Editor'));
  });

  it('gives the chrome back when the page leaves', () => {
    const { rerender } = renderWorkspace(true);
    assert.equal(screen.queryByRole('navigation', { name: 'Sections' }) === null, true);

    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <TooltipProvider>
            <AppShell nav={NAV} userLabel="admin@iace.co.in" onSignOut={() => {}}>
              <p>Page</p>
            </AppShell>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    assert.ok(screen.getByRole('navigation', { name: 'Sections' }));
  });
});

describe('AppShell', () => {
  /** The lockup replaces the Overview and Home nav rows, so it has to be the way back. */
  it('makes the brandmark the link home', () => {
    setDesktop(true);
    renderShell({ homeTo: '/' });

    assert.equal(screen.getByRole('link', { name: /IACE/ }).getAttribute('href'), '/');
  });

  it('names the portal beside the lockup', () => {
    setDesktop(true);
    renderShell({ portal: 'Admin' });

    assert.ok(screen.getByText('Admin'));
  });

  it('renders the sidebar when there are sections', () => {
    setDesktop(true);
    renderShell();

    assert.ok(screen.getByRole('navigation', { name: 'Sections' }));
  });

  /**
   * The student app has one screen and so no nav. An empty sidebar is a column
   * of nothing beside the page.
   */
  it('draws no sidebar when there are no sections', () => {
    setDesktop(true);
    renderShell({ nav: [] });

    assert.equal(screen.queryByRole('navigation'), null);
  });

  /** Same on mobile: no sections means nothing for the hamburger to open. */
  it('offers no drawer when there are no sections', () => {
    setDesktop(false);
    renderShell({ nav: [] });

    assert.equal(screen.queryByRole('button', { name: 'Open navigation' }), null);
  });

  /** The account menu is in the header, so it survives an app with no sidebar. */
  it('keeps the account menu reachable with no sections', () => {
    setDesktop(true);
    renderShell({ nav: [] });

    assert.ok(screen.getByRole('button', { name: /admin@iace\.co\.in/ }));
  });

  /**
   * The shell is a fixed-height frame and its content region is what scrolls, so
   * a framed page can take the height instead. @iace/ui owns that class because it
   * also owns the `data-page-frame` the selector matches.
   */
  it('scrolls its content region, not the document', () => {
    setDesktop(true);
    const { container } = renderShell();

    const page = screen.getByText('Page').parentElement;
    assert.equal(page?.className.includes(PAGE_CONTENT_CLASS), true);
    assert.match(container.firstElementChild?.className ?? '', /h-dvh/);
    assert.match(container.firstElementChild?.className ?? '', /overflow-hidden/);
  });
});

const SECTIONED: readonly NavItem[] = [
  {
    label: 'Students',
    children: [
      { to: '/students', label: 'All students' },
      { to: '/students/import', label: 'Import students' },
    ],
  },
  {
    label: 'Tests',
    children: [
      { to: '/tests/configs', label: 'Base configurations' },
      { to: '/tests/series', label: 'Test series' },
    ],
  },
];

/** Seven children, one past NAV_INLINE_MAX_ITEMS, so it resolves to PANEL. */
const BIG: readonly NavItem[] = [
  {
    label: 'Everything',
    children: Array.from({ length: 7 }, (_, i) => ({ to: `/x/${i}`, label: `Item ${i}` })),
  },
];

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

describe('AppShell — the nav panel overlays, it never reflows the page', () => {
  /** It used to widen a flex sibling of <main>, so opening the menu moved every screen. */
  it('leaves the rail the same width whether the panel is open or shut', async () => {
    setDesktop(true);
    renderShell({ nav: SECTIONED });

    const rail = screen.getByRole('navigation', { name: 'Sections' }).parentElement;
    const shut = rail?.className;

    openPanel();
    await screen.findByRole('dialog');

    assert.equal(rail?.className, shut);
    assert.match(shut ?? '', /w-\[--sidebar-w-rail\]/);
  });

  /** Portalled out of the layout row, so nothing it covers is asked to make space for it. */
  it('renders the panel outside the row that holds the page', async () => {
    setDesktop(true);
    renderShell({ nav: SECTIONED });
    openPanel();

    const dialog = await screen.findByRole('dialog');
    const pageRow = screen.getByText('Page').closest('main')?.parentElement;

    assert.ok(pageRow);
    assert.equal(pageRow?.contains(dialog), false);
  });

  it('closes itself when a destination is chosen', async () => {
    setDesktop(true);
    renderShell({ nav: SECTIONED });
    openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Students/ }));
    fireEvent.click(await screen.findByRole('link', { name: 'All students' }));

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  });

  /** Two open at once would grow the list past the panel and hand it a scrollbar. */
  it('keeps one section open at a time', async () => {
    setDesktop(true);
    renderShell({ nav: SECTIONED });
    openPanel();

    const students = await screen.findByRole('button', { name: /Students/ });
    fireEvent.click(students);
    assert.equal(students.getAttribute('aria-expanded'), 'true');

    const tests = screen.getByRole('button', { name: /Tests/ });
    fireEvent.click(tests);

    await waitFor(() => assert.equal(students.getAttribute('aria-expanded'), 'false'));
    assert.equal(tests.getAttribute('aria-expanded'), 'true');
  });

  /** Past the threshold it opens beside the panel instead, so the panel never scrolls. */
  it('gives an oversized section a popover rather than an accordion', async () => {
    setDesktop(true);
    renderShell({ nav: BIG });
    openPanel();

    // A popover trigger also carries aria-expanded, so haspopup is what tells the two apart.
    const section = await screen.findByRole('button', { name: /Everything/ });
    assert.equal(section.getAttribute('aria-haspopup'), 'dialog');

    fireEvent.click(section);
    const listed = await screen.findAllByRole('link', { name: /^Item / });
    assert.equal(listed.length, 7);
  });

  /** Below the rail breakpoint there is no nav in the page, so the header button is the way in. */
  it('draws no rail on a small screen, but still opens the same panel', async () => {
    setDesktop(false);
    renderShell({ nav: SECTIONED });

    assert.equal(screen.queryByRole('navigation', { name: 'Sections' }), null);
    openPanel();
    assert.ok(await screen.findByRole('dialog'));
  });

  /** A rail row is a bare glyph, so the name has to arrive on hover — and on focus. */
  it('names a rail icon with a tooltip, not just a title attribute', async () => {
    setDesktop(true);
    renderShell({ nav: SECTIONED });

    const row = screen.getByRole('button', { name: /Students/ });
    assert.equal(row.getAttribute('title'), null);

    fireEvent.focus(row);
    const named = await screen.findAllByText('Students');
    assert.ok(named.length > 1, 'the tooltip should add a second rendering of the label');
  });

  /** Touch drills down in the panel: a popover on a phone is a modal over a modal. */
  it('drills into a section on a small screen rather than expanding it', async () => {
    setDesktop(false);
    renderShell({ nav: SECTIONED });
    openPanel();

    const students = await screen.findByRole('button', { name: /Students/ });
    assert.equal(students.getAttribute('aria-expanded'), null);
    assert.equal(students.getAttribute('aria-haspopup'), null);

    fireEvent.click(students);

    // The level replaced the list: its children are here and the siblings are gone.
    assert.ok(await screen.findByRole('link', { name: 'All students' }));
    assert.equal(screen.queryByRole('button', { name: /Tests/ }), null);
  });

  it('offers a way back out of a drilled section', async () => {
    setDesktop(false);
    renderShell({ nav: SECTIONED });
    openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Students/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Students' }));

    assert.ok(await screen.findByRole('button', { name: /Tests/ }));
  });

  /** No popover on touch, whatever the child count says. */
  it('drills into an oversized section on a small screen too', async () => {
    setDesktop(false);
    renderShell({ nav: BIG });
    openPanel();

    const section = await screen.findByRole('button', { name: /Everything/ });
    assert.equal(section.getAttribute('aria-haspopup'), null);

    fireEvent.click(section);
    assert.equal((await screen.findAllByRole('link', { name: /^Item / })).length, 7);
  });
});

/**
 * The failure this exists to prevent: a route that extends a sibling's used to light both rows, and
 * the first attempt at fixing it left `aria-current` on both — NavLink defaults the prop to "page"
 * and gates it on its own prefix match, so passing `undefined` changed nothing.
 */
describe('AppShell — which row is current', () => {
  const SECTIONED: readonly NavItem[] = [
    {
      label: 'Students',
      children: [
        { to: '/students', label: 'All students' },
        { to: '/students/import', label: 'Import students' },
      ],
    },
  ];

  function renderAt(pathname: string) {
    setDesktop(true);
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <ThemeProvider>
          <TooltipProvider>
            <AppShell nav={SECTIONED} userLabel="admin@iace.co.in" onSignOut={() => {}}>
              <p>content</p>
            </AppShell>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  }

  it('marks exactly one row current on a route that extends another', async () => {
    renderAt('/students/import');

    const section = screen.getByRole('button', { name: /students/i });
    section.click();

    const current = await screen.findAllByRole('link', { current: 'page' });
    assert.deepEqual(
      current.map((link) => link.textContent),
      ['Import students'],
    );
  });

  it('falls back to the parent for a route no row owns', async () => {
    renderAt('/students/stu_42');

    const section = screen.getByRole('button', { name: /students/i });
    section.click();

    const current = await screen.findAllByRole('link', { current: 'page' });
    assert.deepEqual(
      current.map((link) => link.textContent),
      ['All students'],
    );
  });
});
