import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { requestPersistentStorage } from './pwa/storage';
import { startSync } from './sync/manager';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

applyTheme();
watchSystemTheme();
void requestPersistentStorage();
void startSync().catch((err) => console.warn('Sync failed to start', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
