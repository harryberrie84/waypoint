import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyAppearance, loadAppearance, bootMode } from './lib/theme';
import { warmLazyParts } from './lib/lazyParts';

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

// A part that loads on first use can fail to load after a deploy: the page was
// built against the previous version's files, which the server no longer has.
// Reloading picks up the new version. Once a minute at most, and never offline,
// where the cached copy is the only one there is.
window.addEventListener('vite:preloadError', (event) => {
  if (!navigator.onLine) return;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem('waypoint:reloadedForParts') || 0);
  } catch {
    /* storage unavailable */
  }
  if (Date.now() - last < 60000) return;
  try {
    sessionStorage.setItem('waypoint:reloadedForParts', String(Date.now()));
  } catch {
    /* storage unavailable */
  }
  event.preventDefault();
  window.location.reload();
});
if (import.meta.env.PROD) warmLazyParts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackLabel="The app hit an unexpected error.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
