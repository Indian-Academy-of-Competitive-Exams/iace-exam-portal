import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { PageErrorBoundary } from '../src/components/ui/page-error-boundary';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

function Broken(): never {
  throw new TypeError('Failed to fetch dynamically imported module');
}

/** React logs every throw a boundary catches; the noise is not what is under test. */
function renderQuietly(page: React.ReactElement) {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    return render(page);
  } finally {
    console.error = quiet;
  }
}

describe('PageErrorBoundary', () => {
  it('draws its page when nothing throws', () => {
    render(
      <PageErrorBoundary>
        <p>Students</p>
      </PageErrorBoundary>,
    );
    assert.ok(screen.getByText('Students'));
  });

  it('keeps a page that failed to load inside its own region, with a way out', () => {
    renderQuietly(
      <main>
        <nav>Shell</nav>
        <PageErrorBoundary>
          <Broken />
        </PageErrorBoundary>
      </main>,
    );
    assert.ok(screen.getByText('Shell'));
    assert.ok(screen.getByRole('heading', { name: 'This page could not load' }));
    assert.ok(screen.getByRole('button', { name: 'Retry' }));
  });

  /** The failure this prevents: the outlet reuses the boundary, so one chunk that did not load blanked every screen opened after it. */
  it('draws the next page once the address moves on from the one that failed', () => {
    const { rerender } = renderQuietly(
      <PageErrorBoundary>
        <Broken />
      </PageErrorBoundary>,
    );

    window.history.pushState({}, '', '/students');
    rerender(
      <PageErrorBoundary>
        <p>Students</p>
      </PageErrorBoundary>,
    );

    assert.ok(screen.getByText('Students'));
    assert.equal(screen.queryAllByRole('button', { name: 'Retry' }).length, 0);
  });

  /** A re-render at the same address is not a navigation: the import that failed is still rejected. */
  it('holds the failure while the address stays where it failed', () => {
    const { rerender } = renderQuietly(
      <PageErrorBoundary>
        <Broken />
      </PageErrorBoundary>,
    );

    rerender(
      <PageErrorBoundary>
        <p>Students</p>
      </PageErrorBoundary>,
    );

    assert.ok(screen.getByRole('button', { name: 'Retry' }));
    assert.equal(screen.queryAllByText('Students').length, 0);
  });
});
