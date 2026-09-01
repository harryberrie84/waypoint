import { useEffect, useState } from 'react';
import { X, Share } from 'lucide-react';

// AddToHomePrompt, a one-time nudge on mobile to install the app to the home
// screen. Android/Chrome fires `beforeinstallprompt`, which we defer and trigger
// from the "add" button. iOS has no such event, so we show the manual share-sheet
// tip instead. Dismissed once, never shown again.

const DISMISS_KEY = 'waypoint:installDismissed';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function AddToHomePrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* private mode: just show it */
    }
    if (window.matchMedia?.('(display-mode: standalone)').matches) return;
    if (!window.matchMedia?.('(max-width: 767px)').matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !standalone) {
      setIsIos(true);
      setShow(true);
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore quota */
    }
  };

  const install = () => {
    if (!deferred) return;
    void deferred.prompt();
    void deferred.userChoice.finally(dismiss);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-[101] flex items-center gap-3 rounded-xl border border-paper-line bg-paper px-3 py-2.5 shadow-lg dark:border-coal-line dark:bg-coal-panel md:hidden">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-clay text-white">
        <Share className="h-4 w-4" />
      </span>
      {isIos ? (
        <p className="min-w-0 flex-1 text-xs text-ink-soft dark:text-coal-soft">
          add to home screen: tap share, then “add to home screen”.
        </p>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-xs text-ink-soft dark:text-coal-soft">add waypoint to your home screen</p>
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-lg bg-clay px-3 py-1.5 text-xs font-semibold text-white hover:bg-clay-soft"
          >
            add
          </button>
        </>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
