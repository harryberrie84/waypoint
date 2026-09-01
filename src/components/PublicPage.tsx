import { useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { pagesApi } from '../lib/api';
import { isEnvelope } from '../lib/crypto';
import { coverStyle } from '../lib/cover';
import { Editor } from './Editor';
import { PageIcon } from './PageIcon';
import type { Page } from '../types';

// A read-only render of one page reached by its public token (/?share=<token>),
// shown without an account: the "share our trip" page family sends home. Embedded
// tables and live blocks need the signed-in store, so they stay blank here; the
// cover, title, prose, headings, lists, and images show. The viewer has no theme
// toggle, so we follow the OS light/dark preference for the length of the visit.
export function PublicPage({ token }: { token: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void pagesApi.getPublic(token).then((p) => {
      if (!alive) return;
      setPage(p);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  // Honour the OS colour scheme (no in-app toggle on a public visit), and title
  // the tab with the page. Both are cleaned up if the component ever unmounts.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('dark', mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      root.classList.remove('dark');
    };
  }, []);

  useEffect(() => {
    if (page) document.title = `${page.title || 'Untitled'} · Waypoint`;
  }, [page]);

  if (loading) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-clay" />
      </Centered>
    );
  }
  if (!page) {
    return <Centered>this link isn&rsquo;t available. it may have been turned off, or the page is private.</Centered>;
  }
  if (isEnvelope(page.content)) {
    return <Centered>this page is encrypted and can&rsquo;t be shared publicly.</Centered>;
  }

  const hasCover = !!page.cover;

  return (
    <div className="min-h-screen bg-paper dark:bg-coal">
      {hasCover && (
        <div className="relative h-52 w-full md:h-72" style={coverStyle(page.cover)}>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        </div>
      )}

      <div className={`mx-auto max-w-3xl px-5 pb-20 sm:px-8 ${hasCover ? 'pt-0' : 'pt-14'}`}>
        <div className={`flex items-center gap-3 ${hasCover ? '-mt-9' : ''}`}>
          <span className="flex items-center rounded-2xl bg-paper p-1.5 shadow-sm dark:bg-coal">
            <PageIcon icon={page.icon} size="h-14 w-14" />
          </span>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
          <Globe className="h-3.5 w-3.5" /> shared trip &middot; read only
        </div>
        <h1 className="mb-6 mt-1 text-3xl font-semibold text-ink dark:text-coal-text sm:text-4xl">
          {page.title || 'Untitled'}
        </h1>

        <Editor content={(page.content as object) ?? null} editable={false} onChange={() => {}} />

        <footer className="mt-16 border-t border-paper-line pt-5 text-xs text-ink-faint dark:border-coal-line dark:text-coal-soft">
          <span className="flex items-center gap-1.5 font-medium">
            <Globe className="h-3.5 w-3.5" /> shared from Waypoint
          </span>
          <p className="mt-1 opacity-80">a read-only snapshot. live tables, maps and the moodboard open in the app.</p>
        </footer>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6 text-center text-sm text-ink-faint dark:bg-coal dark:text-coal-soft">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
