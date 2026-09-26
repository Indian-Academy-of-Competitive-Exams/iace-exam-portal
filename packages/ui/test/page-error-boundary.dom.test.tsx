import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { PageErrorBoundary } from '../src/components/ui/page-error-boundary';

afterEach(cleanup);

function Broken(): never {
  throw new TypeError('Failed to fetch dynamically imported module');
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
    const quiet = console.error;
    console.error = () => undefined;
    try {
      render(
        <main>
          <nav>Shell</nav>
          <PageErrorBoundary>
            <Broken />
          </PageErrorBoundary>
        </main>,
      );
    } finally {
      console.error = quiet;
    }
    assert.ok(screen.getByText('Shell'));
    assert.ok(screen.getByRole('heading', { name: 'This page could not load' }));
    assert.ok(screen.getByRole('button', { name: 'Retry' }));
  });
});
