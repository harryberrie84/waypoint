// ---------------------------------------------------------------------------
// voteIO, text <-> vote for the /vote widget (the round-trip the setlist has).
// A plain, hand-writable format so a poll can be authored in a file or handed to
// someone, then imported as a fresh poll (votes start empty):
//
//   # Where should we eat?
//
//   mode: single
//
//   - Ramen
//   - Sushi
//   - Izakaya
//
// The `# ...` line is the question. `mode: single` or `mode: multi` sets whether
// several picks are allowed (default multi). Each `- ...` line is an option. Live
// vote counts (voters) are never serialized, an imported poll starts fresh. Pure.

export interface VoteIOOption {
  text: string;
}

export function serializeVote(question: string, multi: boolean, options: VoteIOOption[]): string {
  const out: string[] = [];
  if (question.trim()) out.push(`# ${question.trim()}`, '');
  out.push(`mode: ${multi ? 'multi' : 'single'}`, '');
  for (const o of options) out.push(`- ${o.text}`.trimEnd());
  return out.join('\n') + '\n';
}

export function parseVote(text: string): { question: string; multi: boolean; options: VoteIOOption[] } {
  const result: { question: string; multi: boolean; options: VoteIOOption[] } = { question: '', multi: true, options: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!result.question) result.question = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    const mode = /^mode:\s*(single|multi)/i.exec(line);
    if (mode) {
      result.multi = mode[1].toLowerCase() === 'multi';
      continue;
    }
    const opt = line.replace(/^[-*]\s*/, '').trim();
    if (opt) result.options.push({ text: opt });
  }
  return result;
}

export const VOTE_TEMPLATE = `# What are we deciding?

mode: single

- First option
- Second option
- Third option
`;
