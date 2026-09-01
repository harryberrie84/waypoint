// A small, dependency-free code tokenizer for editor code blocks. Not a real
// lexer per language; it recognises the universal shapes (comments, strings,
// numbers) plus a union of common keywords, which reads well for JS/TS, Python,
// shell, Go, Rust, JSON and friends without shipping highlight.js. Returns token
// ranges as offsets into the input; the editor turns them into decorations.

export interface CodeToken {
  from: number;
  to: number;
  cls: string;
}

const KEYWORDS = new Set([
  // JS / TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'await', 'async',
  'yield', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'try', 'catch', 'finally', 'throw', 'interface',
  'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'static', 'as', 'namespace',
  // values
  'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil',
  // Python
  'def', 'elif', 'lambda', 'with', 'except', 'raise', 'pass', 'and', 'or', 'not', 'is', 'global', 'assert',
  // shell
  'then', 'fi', 'done', 'esac', 'echo', 'export', 'local', 'function',
  // Go / Rust
  'func', 'package', 'defer', 'chan', 'go', 'select', 'struct', 'fn', 'impl', 'pub', 'use', 'match', 'mut',
  'trait', 'where', 'self', 'Self', 'mod', 'crate',
]);

const LINE_COMMENTS = ['//', '#', '--'];

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

export function highlightCode(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  const n = code.length;

  while (i < n) {
    const c = code[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Block comment
    if (c === '/' && code[i + 1] === '*') {
      let j = code.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      tokens.push({ from: i, to: j, cls: 'tok-comment' });
      i = j;
      continue;
    }

    // Line comment
    const lc = LINE_COMMENTS.find((p) => code.startsWith(p, i));
    if (lc) {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      tokens.push({ from: i, to: j, cls: 'tok-comment' });
      i = j;
      continue;
    }

    // String (single, double, backtick)
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      tokens.push({ from: i, to: j, cls: 'tok-string' });
      i = j;
      continue;
    }

    // Number
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9._a-fA-FxX]/.test(code[j])) j++;
      tokens.push({ from: i, to: j, cls: 'tok-number' });
      i = j;
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && isWordChar(code[j])) j++;
      const word = code.slice(i, j);
      if (KEYWORDS.has(word)) tokens.push({ from: i, to: j, cls: 'tok-keyword' });
      i = j;
      continue;
    }

    i++;
  }

  return tokens;
}
