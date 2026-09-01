// Parse a pasted markdown / GitHub-style pipe table into headers + rows, and
// split mixed text into ordered text and table blocks. Pure and dependency-free.
// A table is a header row of pipes, a separator row (| --- | --- |), then data.

export interface MdTable {
  headers: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

export function parseMarkdownTable(text: string): MdTable | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2 || !lines[0].includes('|') || !isSeparator(lines[1])) return null;
  const headers = splitRow(lines[0]);
  if (headers.length < 1) return null;
  const rows = lines
    .slice(2)
    .filter((l) => l.includes('|'))
    .map((l) => {
      const cells = splitRow(l);
      while (cells.length < headers.length) cells.push('');
      return cells.slice(0, headers.length);
    });
  return { headers, rows };
}

export type MdBlock = { type: 'text'; text: string } | { type: 'table'; table: MdTable };

/** Walk text top to bottom, pulling out any pipe tables into their own blocks so
 *  mixed paste (a paragraph, a table, more text) keeps its order. Returns null
 *  when there is no table at all (let the normal paste path handle it). */
export function splitMarkdownTables(text: string): MdBlock[] | null {
  const lines = text.split(/\r?\n/);
  const blocks: MdBlock[] = [];
  let buf: string[] = [];
  let sawTable = false;
  const flush = () => {
    if (buf.join('\n').trim()) blocks.push({ type: 'text', text: buf.join('\n') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) j++;
      const table = parseMarkdownTable(lines.slice(i, j).join('\n'));
      if (table) {
        flush();
        blocks.push({ type: 'table', table });
        sawTable = true;
        i = j - 1;
        continue;
      }
    }
    buf.push(lines[i]);
  }
  flush();
  return sawTable ? blocks : null;
}
