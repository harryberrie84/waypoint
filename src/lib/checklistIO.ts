// ---------------------------------------------------------------------------
// checklistIO, text <-> checklist for the packing / readiness widgets (the same
// round-trip the setlist widget has). A plain markdown-checkbox format so a list
// can be authored in a file or the clipboard and a blank template filled in:
//
//   # Packing
//
//   - [x] Passport @Alex
//   - [ ] Charger
//   - [ ] Sunscreen
//
// One item per line: `- [x]` done, `- [ ]` not. A trailing ` @owner` names who it
// is for (packing only; readiness has none). The title is the `# ...` line. A
// bare line with no checkbox is taken as an unchecked item, so a plain list pastes
// in too. Pure: no React, no DOM.

export interface ChecklistItem {
  text: string;
  done: boolean;
  owner?: string; // display name of who it's for (packing); absent for readiness
}

export function serializeChecklist(title: string, items: ChecklistItem[]): string {
  const out: string[] = [];
  if (title.trim()) out.push(`# ${title.trim()}`, '');
  for (const it of items) {
    const box = it.done ? '[x]' : '[ ]';
    const owner = it.owner && it.owner.trim() ? ` @${it.owner.trim()}` : '';
    out.push(`- ${box} ${it.text}${owner}`.trimEnd());
  }
  return out.join('\n') + '\n';
}

const CHECK_LINE = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/;

// Split a trailing " @owner" off the end of an item, keeping multi-word names.
function splitOwner(s: string): { text: string; owner?: string } {
  const at = s.lastIndexOf(' @');
  if (at >= 0) return { text: s.slice(0, at).trim(), owner: s.slice(at + 2).trim() || undefined };
  if (s.startsWith('@')) return { text: '', owner: s.slice(1).trim() || undefined };
  return { text: s };
}

export function parseChecklist(text: string): { title: string; items: ChecklistItem[] } {
  const result: { title: string; items: ChecklistItem[] } = { title: '', items: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!result.title) result.title = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    const m = CHECK_LINE.exec(line);
    // A checkbox line carries its done state; a bare line is an unchecked item.
    const done = m ? m[1].toLowerCase() === 'x' : false;
    const body = m ? m[2].trim() : line.replace(/^[-*]\s*/, '').trim();
    if (!body) continue;
    const { text: itemText, owner } = splitOwner(body);
    result.items.push({ text: itemText, done, ...(owner ? { owner } : {}) });
  }
  return result;
}

export const PACKING_TEMPLATE = `# Packing

- [ ] Passport @Alex
- [ ] Chargers and adapters
- [x] Travel insurance printout
- [ ] Toiletries
- [ ] A book for the flight
`;

export const READINESS_TEMPLATE = `# Trip readiness

- [x] Flights booked
- [ ] Somewhere to stay
- [ ] Passports valid
- [ ] Travel insurance
- [ ] Packed
`;
