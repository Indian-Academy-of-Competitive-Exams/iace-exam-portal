import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Design tokens first: every colour, radius and shadow in the app resolves
// against these CSS variables.
import '@iace/ui/tokens.css';
import './index.css';

import { AppProviders } from './providers/app-providers';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
