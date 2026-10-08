import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from '../browser/protected-route';

afterEach(cleanup);

function SignIn() {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return <p>Sign in, then back to {from}</p>;
}

type Gate = Partial<React.ComponentProps<typeof ProtectedRoute>>;

const gated = (gate: Gate) => (
  <MemoryRouter initialEntries={['/exam/tst_1?q=4']}>
    <Routes>
      <Route path="/login" element={<SignIn />} />
      <Route
        element={
          <ProtectedRoute isAuthenticated={false} isLoading={false} loginPath="/login" {...gate} />
        }
      >
        <Route path="/exam/:testId" element={<p>The paper</p>} />
      </Route>
    </Routes>
  </MemoryRouter>
);

describe('ProtectedRoute', () => {
  /** The failure this prevents: a server down at reload reading as signed out, mid-paper. */
  it('offers a retry on the address it was opened at when the server did not answer', () => {
    let retried = 0;
    const view = render(gated({ isUnreachable: true, onRetry: () => (retried += 1) }));

    assert.equal(screen.queryByText(/Sign in/), null);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    assert.equal(retried, 1);

    view.rerender(gated({ isAuthenticated: true }));

    assert.ok(screen.getByText('The paper'));
  });

  it('sends a signed-out reader to sign in, with the way back', () => {
    render(gated({}));

    assert.ok(screen.getByText('Sign in, then back to /exam/tst_1?q=4'));
  });
});
