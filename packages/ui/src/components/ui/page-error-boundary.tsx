import * as React from 'react';
import { EmptyState, EMPTY_STATE_KINDS } from './empty-state';

interface PageErrorBoundaryState {
  failed: boolean;
}

/** A page that threw, or whose chunk did not load, fails in its own region instead of blanking the app. */
export class PageErrorBoundary extends React.Component<
  Readonly<{ children: React.ReactNode }>,
  PageErrorBoundaryState
> {
  override state: PageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
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
