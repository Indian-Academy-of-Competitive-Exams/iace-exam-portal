// Design tokens first: every colour, radius and shadow in the app resolves
// against these CSS variables. Static imports, so the bundler can see them.
import '@iace/ui/tokens.css';
import '@iace/ui/components.css';
// A paper carries equations, so the exam renders them with the same stylesheet the author saw.
import '@iace/ui/katex.css';
import './index.css';

import { toast } from '@iace/ui';
import { createAppQueryClient } from '@iace/app-kit';
import { mountApp } from '@iace/app-kit/browser';

import { AuthProvider } from './providers/auth';
import { App } from './App';
import { captureInstallPrompt, registerServiceWorker } from './lib/pwa';

/** One place every mutation failure is announced. Field-level messages still land on fields. */
const queryClient = createAppQueryClient({ notify: toast });

// Before mount: the browser fires `beforeinstallprompt` early, and an unheard one is gone for good.
captureInstallPrompt();
registerServiceWorker();

mountApp(
  <AuthProvider>
    <App />
  </AuthProvider>,
  { queryClient },
);
