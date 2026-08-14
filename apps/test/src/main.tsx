// Design tokens first: every colour, radius and shadow in the app resolves
// against these CSS variables. Static imports, so the bundler can see them.
import '@iace/ui/tokens.css';
import './index.css';

import { toast } from '@iace/ui';
import { createAppQueryClient } from '@iace/app-kit';
import { mountApp } from '@iace/app-kit/browser';

import { AuthProvider } from './providers/auth';
import { App } from './App';

/**
 * One client, one place every mutation failure is announced.
 *
 * `toast` is a module-level store, so it works from here — outside any
 * component — which is what lets the catch-all live in the client rather than
 * in each form. Field-level messages still land on their fields; this only sees
 * what has nowhere else to go.
 */
const queryClient = createAppQueryClient({ notify: toast });

mountApp(
  <AuthProvider>
    <App />
  </AuthProvider>,
  { queryClient },
);
