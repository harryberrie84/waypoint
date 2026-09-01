import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyAppearance, loadAppearance, bootMode } from './lib/theme';

// Paint the saved theme + font onto <html> before React renders, so there's no
// flash of the default palette on a reload. useTheme re-applies on every
// theme/font/mode change after this.
applyAppearance(loadAppearance(), bootMode());

// Register the service worker (the PWA shell). Production only, in dev the vite
// server already lives at :5173 and caching its assets just gets in the way. The
// SW is scoped to '/' and never sits in front of the PocketBase API.
//
// The build id rides along as ?v= so the SW can name its cache after this build.
// A new build is then a new registration with a new cache, and activate drops the
// old one; the name used to be fixed, so the shell cached by one deploy outlived
// every deploy after it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`/sw.js?v=${__BUILD_ID__}`)
      .catch((err) => console.error('[sw] register failed', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackLabel="The app hit an unexpected error.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
