// ---------------------------------------------------------------------------
// linkMeta, small URL helpers plus a best-effort metadata fetch. Shared by the
// bookmark block and the "add row from link" flow so both resolve titles the
// same way. The pure helpers are tested; the fetch degrades to null on any
// failure (offline, unreachable site, bad URL), and every caller already falls
// back to showing the domain.
//
// The fetch goes to THIS server, which reads the page and returns its metadata
// (server/pb_hooks/link_preview.pb.js). The only party that sees a pasted link is
// the site it points at.
// ---------------------------------------------------------------------------

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// The site's own icon, from the site itself. A favicon service would mean
// handing a third party the domain of everything anyone bookmarks. Sites that
// serve nothing here just render no icon, which the bookmark block handles.
export function faviconUrl(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return '';
  }
}

// Add a scheme if the user pasted a bare host. Empty in → empty out.
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export interface LinkMeta {
  title: string;
  description: string;
  image: string;
}

// Resolve a page's title/description/thumbnail. Returns null on any failure so
// callers can fall back (e.g. to the domain) without a try/catch of their own.
export async function fetchLinkMeta(url: string): Promise<LinkMeta | null> {
  try {
    // Imported here rather than at the top of the file: the helpers above are
    // pure and are pulled into the test runner, which has no bundler and would
    // choke on the client's module-load work.
    const { pb } = await import('./pocketbase');
    // 204 when the server could read the page but found no metadata, which the
    // SDK gives back as an empty body rather than an error.
    const j = await pb.send<Partial<LinkMeta> | null>('/link-preview', { query: { url } });
    if (!j || (!j.title && !j.description && !j.image)) return null;
    return { title: j.title ?? '', description: j.description ?? '', image: j.image ?? '' };
  } catch {
    return null;
  }
}
