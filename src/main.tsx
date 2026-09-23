import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { requestPersistentStorage } from './pwa/storage';
import { onSynced, startSync } from './sync/manager';
import { seedExercises } from './db/seed/exercises';
import { seedFoods } from './db/seed/foods';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

applyTheme();
watchSystemTheme();
void requestPersistentStorage();
void seedExercises().catch((err) => console.warn('Exercise library seed failed', err));
void seedFoods().catch((err) => console.warn('Food database seed failed', err));
void startSync().catch((err) => console.warn('Sync failed to start', err));
// Keep the summary friends see up to date (only if you're in a group; loaded on demand).
onSynced((userId) => void import('./features/friends/api').then((m) => m.publishIfEnabled(userId)).catch(() => {}));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
