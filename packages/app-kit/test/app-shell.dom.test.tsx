import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { PAGE_CONTENT_CLASS, ThemeProvider } from '@iace/ui';
import { AppShell } from '../browser/app-shell';
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
      {/* The header's ThemeToggle reads the theme context and throws without it. */}
      <ThemeProvider>
        <AppShell nav={NAV} userLabel="admin@iace.co.in" onSignOut={() => {}} {...props}>
          <p>Page</p>
        </AppShell>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

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
