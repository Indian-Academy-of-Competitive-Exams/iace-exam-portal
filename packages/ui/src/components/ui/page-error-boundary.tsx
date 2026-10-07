import * as React from 'react';
import { EmptyState, EMPTY_STATE_KINDS } from './empty-state';

interface PageErrorBoundaryState {
  /** The address the page failed at; null while it draws. */
  failedAt: string | null;
}

/** A page that threw, or whose chunk did not load, fails in its own region instead of blanking the app. */
export class PageErrorBoundary extends React.Component<
  Readonly<{ children: React.ReactNode }>,
  PageErrorBoundaryState
> {
  override state: PageErrorBoundaryState = { failedAt: null };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { failedAt: window.location.pathname };
  }

  // A router reuses this instance for the next route, so the failure is held against its address.
  override componentDidUpdate() {
    const { failedAt } = this.state;
    if (failedAt !== null && failedAt !== window.location.pathname) {
      this.setState({ failedAt: null });
    }
  }

  override render() {
    if (this.state.failedAt === null) return this.props.children;
    // A reload, not a re-render: React.lazy keeps a failed import rejected for the life of the page.
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This page could not load"
        onRetry={() => window.location.reload()}
      />
    );
  }
}
