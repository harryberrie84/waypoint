// Parse a github.com URL into a repo / issue / PR reference, and fetch its title
// and open/closed state from the public GitHub API (keyless, rate-limited to 60
// requests an hour, which is plenty for pasting the odd link). Pure parsing; the
// fetch is best-effort and returns null on any failure so the caller degrades to a
// plain bookmark.

export interface GithubRef {
  kind: 'repo' | 'issue' | 'pr';
  owner: string;
  repo: string;
  number?: number;
}

export function parseGithubUrl(url: string): GithubRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (parts.length === 2) return { kind: 'repo', owner, repo };
  if ((parts[2] === 'issues' || parts[2] === 'pull') && parts[3] && /^\d+$/.test(parts[3])) {
    return { kind: parts[2] === 'pull' ? 'pr' : 'issue', owner, repo, number: Number(parts[3]) };
  }
  return null; // a tree/blob/commit url is not a card
}

export interface GithubData {
  title: string;
  state: string; // 'open' | 'closed' | 'merged' | 'archived' | ''
  meta: string; // '#123' or a star count
}

export async function fetchGithub(ref: GithubRef): Promise<GithubData | null> {
  const headers = { Accept: 'application/vnd.github+json' };
  try {
    if (ref.kind === 'repo') {
      const r = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers });
      if (!r.ok) return null;
      const j = await r.json();
      return { title: j.full_name || `${ref.owner}/${ref.repo}`, state: j.archived ? 'archived' : '', meta: `★ ${j.stargazers_count ?? 0}` };
    }
    if (ref.kind === 'pr') {
      const r = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, { headers });
      if (!r.ok) return null;
      const j = await r.json();
      return { title: j.title || `#${ref.number}`, state: j.merged ? 'merged' : j.state || '', meta: `#${ref.number}` };
    }
    const r = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, { headers });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || `#${ref.number}`, state: j.state || '', meta: `#${ref.number}` };
  } catch {
    return null;
  }
}
