// ---------------------------------------------------------------------------
// Formula engine
// ---------------------------------------------------------------------------
// Recursive-descent expression evaluator. No eval()/new Function(), a hostile
// or malformed expression can never execute code. Grammar:
//
//   expr    := term (('+' | '-') term)*
//   term    := power (('*' | '/' | '%') power)*
//   power   := unary ('^' unary)*       (right-associative)
//   unary   := ('-' | '+')? primary
//   primary := number | string | '[' COLUMN ']' | func '(' args ')' | '(' expr ')'
//
// Values are numbers or strings. Arithmetic coerces to number; concat/format
// build text. Functions:
//   math:   sum, min, max, avg, product, count, abs, round, roundto, floor,
//           ceil, trunc, sign, mod, pow, sqrt, clamp, percent
//   text:   concat, text, len, lower, upper, trim, left, right, replace,
//           contains, startswith, endswith
//   logic:  if, and, or, not, isblank, coalesce
//   dates:  today, days, workdays, daysoff, holiday (Swedish red days), format
//   other:  fx (currency)

export type FormulaValue = number | string;
export type FormulaScope = Record<string, FormulaValue>;

// Resolves fx(amount, from, to, manual?) -> converted amount. Injected so the
// engine stays pure and testable; defaults to the live/cached rate table.
export type FxResolve = (amount: number, from: string, to: string, manual?: number) => number;

export interface FormulaResult {
  ok: boolean;
  value: FormulaValue;
  error?: string;
}

import { fxResolve } from './fx';
import { rollDice, type Rng } from './dice';
import { countWorkdays, countDaysOff, isHoliday } from './swedishHolidays';
import { lookupRef } from './refRegistry';

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ref'; name: string }
  | { kind: 'op'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (c === '[') {
      const end = input.indexOf(']', i);
      if (end === -1) throw new Error('Unclosed [ in reference');
      const name = input.slice(i + 1, end).trim();
      if (!name) throw new Error('Empty column reference');
      tokens.push({ kind: 'ref', name });
      i = end + 1;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma' });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = input.indexOf(c, i + 1);
      if (end === -1) throw new Error('Unclosed string');
      tokens.push({ kind: 'str', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if ('+-*/%^'.includes(c)) {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    // Comparison + logical operators (for flow filters/conditions). Two-char
    // forms first so `==`/`>=` don't read as a bare `=`/`>`. A lone `=` is taken
    // as equality, a common way to write it.
    if ('<>=!&|'.includes(c)) {
      const two = input.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
        tokens.push({ kind: 'op', value: two });
        i += 2;
        continue;
      }
      if (c === '>' || c === '<') {
        tokens.push({ kind: 'op', value: c });
        i++;
        continue;
      }
      if (c === '=') {
        tokens.push({ kind: 'op', value: '==' });
        i++;
        continue;
      }
      throw new Error(`Unexpected character "${c}"`);
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`Invalid number "${raw}"`);
      tokens.push({ kind: 'num', value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ kind: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

function asNum(v: FormulaValue): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function asStr(v: FormulaValue): string {
  if (typeof v === 'string') return v;
  return formatNumber(v);
}
function truthy(v: FormulaValue): boolean {
  return typeof v === 'string' ? v.trim() !== '' : v !== 0;
}

// Comparison for flow filters. `==`/`!=` compare as text when either side is a
// string (so `[status] == "done"` works), numeric otherwise; ordering is always
// numeric.
function compare(a: FormulaValue, op: string, b: FormulaValue): boolean {
  if (op === '==' || op === '!=') {
    const eq = typeof a === 'string' || typeof b === 'string' ? asStr(a) === asStr(b) : asNum(a) === asNum(b);
    return op === '==' ? eq : !eq;
  }
  const l = asNum(a);
  const r = asNum(b);
  if (op === '>') return l > r;
  if (op === '>=') return l >= r;
  if (op === '<') return l < r;
  return l <= r;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A day-index (days since the epoch, as stored for date columns) -> a Date.
function dayToDate(dayIndex: number): Date {
  return new Date(Math.round(dayIndex) * 86400000);
}

// Numeric-only built-ins. Text/date built-ins are handled in the parser so they
// can take and return strings.
const FUNCS: Record<string, (args: number[]) => number> = {
  sum: (a) => a.reduce((s, n) => s + n, 0),
  min: (a) => (a.length ? Math.min(...a) : 0),
  max: (a) => (a.length ? Math.max(...a) : 0),
  avg: (a) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0),
  abs: (a) => Math.abs(a[0] ?? 0),
  round: (a) => Math.round(a[0] ?? 0),
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  // mod throws on a zero divisor like the `%` operator does, so a bad expression
  // degrades to {ok:false} rather than silently yielding NaN.
  mod: (a) => {
    const d = a[1] ?? 0;
    if (d === 0) throw new Error('Modulo by zero');
    return (a[0] ?? 0) % d;
  },
  clamp: (a) => Math.min(Math.max(a[0] ?? 0, a[1] ?? -Infinity), a[2] ?? Infinity),
  product: (a) => a.reduce((s, n) => s * n, 1),
  count: (a) => a.length,
  pow: (a) => Math.pow(a[0] ?? 0, a[1] ?? 0),
  sqrt: (a) => Math.sqrt(a[0] ?? 0),
  sign: (a) => Math.sign(a[0] ?? 0),
  trunc: (a) => Math.trunc(a[0] ?? 0),
  // round to N decimals: roundto(12.345, 2) -> 12.35
  roundto: (a) => {
    const d = Math.max(0, Math.round(a[1] ?? 0));
    const f = 10 ** d;
    return Math.round((a[0] ?? 0) * f) / f;
  },
  // part as a percentage of whole: percent(3, 4) -> 75
  percent: (a) => {
    const whole = a[1] ?? 0;
    return whole === 0 ? 0 : ((a[0] ?? 0) / whole) * 100;
  },
  // --- statistics, added for the spreadsheet ---------------------------------
  median: (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  // Sample standard deviation (n-1), the one a spreadsheet means by STDEV.
  stdev: (a) => (a.length < 2 ? 0 : Math.sqrt(variance(a, 1))),
  stdevp: (a) => (a.length ? Math.sqrt(variance(a, 0)) : 0),
  variance: (a) => (a.length < 2 ? 0 : variance(a, 1)),
  varp: (a) => (a.length ? variance(a, 0) : 0),
  mode: (a) => {
    let best = 0;
    let bestSeen = 0;
    for (const n of a) {
      const seen = a.filter((x) => x === n).length;
      if (seen > bestSeen) {
        bestSeen = seen;
        best = n;
      }
    }
    return bestSeen > 1 ? best : (a[0] ?? 0);
  },
  sumsq: (a) => a.reduce((s, n) => s + n * n, 0),
  // --- more maths ------------------------------------------------------------
  ln: (a) => Math.log(a[0] ?? 0),
  // log(x) is base 10 like a spreadsheet, log(x, b) takes an explicit base.
  log: (a) => (a.length > 1 ? Math.log(a[0] ?? 0) / Math.log(a[1] ?? 10) : Math.log10(a[0] ?? 0)),
  exp: (a) => Math.exp(a[0] ?? 0),
  int: (a) => Math.floor(a[0] ?? 0),
  // Away from / toward zero at N decimals, so a negative rounds the way a
  // spreadsheet user expects rather than the way Math.ceil does.
  roundup: (a) => {
    const f = 10 ** Math.max(0, Math.round(a[1] ?? 0));
    const v = (a[0] ?? 0) * f;
    return (v < 0 ? -Math.ceil(-v) : Math.ceil(v)) / f;
  },
  rounddown: (a) => {
    const f = 10 ** Math.max(0, Math.round(a[1] ?? 0));
    const v = (a[0] ?? 0) * f;
    return (v < 0 ? -Math.floor(-v) : Math.floor(v)) / f;
  },
  even: (a) => {
    const v = a[0] ?? 0;
    const up = Math.ceil(Math.abs(v) / 2) * 2;
    return v < 0 ? -up : up;
  },
  odd: (a) => {
    const v = a[0] ?? 0;
    const n = Math.ceil(Math.abs(v));
    const up = n % 2 === 0 ? n + 1 : n;
    return v < 0 ? -up : up;
  },
  fact: (a) => {
    const n = Math.floor(a[0] ?? 0);
    if (n < 0 || n > 170) throw new Error('fact: out of range');
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
  },
  gcd: (a) => a.map((n) => Math.abs(Math.round(n))).reduce((x, y) => (y ? gcd2(x, y) : x), 0),
  lcm: (a) => a.map((n) => Math.abs(Math.round(n))).reduce((x, y) => (x && y ? (x * y) / gcd2(x, y) : 0), 1),
};

function variance(a: number[], ddof: 0 | 1): number {
  const mean = a.reduce((s, n) => s + n, 0) / a.length;
  return a.reduce((s, n) => s + (n - mean) ** 2, 0) / (a.length - ddof);
}
function gcd2(x: number, y: number): number {
  let a = x;
  let b = y;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Does a value satisfy a spreadsheet criterion? Accepts ">5", ">=5", "<5",
 *  "<=5", "<>x", "=x", or a bare value meaning equality. Text compares
 *  case-insensitively, which is what a spreadsheet does and what people expect
 *  when they type a name. Exported for the sheet's own filtering. */
export function matchCriterion(value: FormulaValue, criterion: FormulaValue): boolean {
  const c = asStr(criterion).trim();
  const cmp = (op: string, rest: string): boolean => {
    const n = Number(rest);
    if (!Number.isNaN(n) && rest.trim() !== '') {
      const v = asNum(value);
      if (op === '>') return v > n;
      if (op === '>=') return v >= n;
      if (op === '<') return v < n;
      if (op === '<=') return v <= n;
      if (op === '<>') return v !== n;
      return v === n;
    }
    const v = asStr(value).toLowerCase();
    const r = rest.trim().toLowerCase();
    if (op === '<>') return v !== r;
    return v === r;
  };
  for (const op of ['>=', '<=', '<>', '>', '<', '=']) {
    if (c.startsWith(op)) return cmp(op, c.slice(op.length));
  }
  return cmp('=', c);
}

class Parser {
  private pos = 0;
  private tokens: Token[];
  private scope: FormulaScope;
  private fx: FxResolve;
  private rng?: Rng;

  constructor(tokens: Token[], scope: FormulaScope, fx: FxResolve, rng?: Rng) {
    this.tokens = tokens;
    this.scope = scope;
    this.fx = fx;
    this.rng = rng;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): FormulaValue {
    const value = this.orExpr();
    if (this.pos !== this.tokens.length) throw new Error('Unexpected trailing tokens');
    return value;
  }

  // Logic + comparison sit above arithmetic so `[a] > 1 && [b] == 2` parses as
  // `([a] > 1) && ([b] == 2)`. Boolean results are 1/0 so `if(...)` / truthy read
  // them. These are used by flow filters/conditions; plain formulas never hit
  // them (no comparison operators) and parse exactly as before.
  private orExpr(): FormulaValue {
    let left = this.andExpr();
    let t = this.peek();
    while (t && t.kind === 'op' && t.value === '||') {
      this.next();
      const right = this.andExpr();
      left = truthy(left) || truthy(right) ? 1 : 0;
      t = this.peek();
    }
    return left;
  }

  private andExpr(): FormulaValue {
    let left = this.comparison();
    let t = this.peek();
    while (t && t.kind === 'op' && t.value === '&&') {
      this.next();
      const right = this.comparison();
      left = truthy(left) && truthy(right) ? 1 : 0;
      t = this.peek();
    }
    return left;
  }

  private comparison(): FormulaValue {
    const left = this.expr();
    const t = this.peek();
    if (t && t.kind === 'op' && (t.value === '==' || t.value === '!=' || t.value === '>' || t.value === '>=' || t.value === '<' || t.value === '<=')) {
      this.next();
      const right = this.expr();
      return compare(left, t.value, right) ? 1 : 0;
    }
    return left;
  }

  private expr(): FormulaValue {
    let left = this.term();
    let t = this.peek();
    while (t && t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      this.next();
      const right = this.term();
      left = t.value === '+' ? asNum(left) + asNum(right) : asNum(left) - asNum(right);
      t = this.peek();
    }
    return left;
  }

  private term(): FormulaValue {
    let left = this.power();
    let t = this.peek();
    while (t && t.kind === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
      this.next();
      const right = asNum(this.power());
      const l = asNum(left);
      if (t.value === '*') left = l * right;
      else if (t.value === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = l / right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        left = l % right;
      }
      t = this.peek();
    }
    return left;
  }

  private power(): FormulaValue {
    const base = this.unary();
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === '^') {
      this.next();
      const exp = asNum(this.power());
      return Math.pow(asNum(base), exp);
    }
    return base;
  }

  private unary(): FormulaValue {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const v = asNum(this.unary());
      return t.value === '-' ? -v : v;
    }
    return this.primary();
  }

  // Parse a parenthesised, comma-separated argument list (already past the '(').
  private args(): FormulaValue[] {
    const out: FormulaValue[] = [];
    if (this.peek() && this.peek()!.kind !== 'rparen') {
      out.push(this.orExpr());
      while (this.peek() && this.peek()!.kind === 'comma') {
        this.next();
        out.push(this.orExpr());
      }
    }
    const close = this.next();
    if (!close || close.kind !== 'rparen') throw new Error('Expected )');
    return out;
  }

  private primary(): FormulaValue {
    const t = this.next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'num') return t.value;
    if (t.kind === 'str') return t.value;
    if (t.kind === 'ref') {
      const v = this.scope[t.name];
      return v === undefined ? 0 : v;
    }
    if (t.kind === 'lparen') {
      const v = this.orExpr();
      const close = this.next();
      if (!close || close.kind !== 'rparen') throw new Error('Expected )');
      return v;
    }
    if (t.kind === 'ident') {
      // An identifier followed by "(" is a function call; otherwise it is a bare
      // variable, a single-word column or a value named on the page ("STR = 15").
      // Look it up in scope (exact, then case-insensitive), 0 when unknown.
      if (this.peek()?.kind !== 'lparen') {
        if (this.scope[t.value] !== undefined) return this.scope[t.value];
        const key = Object.keys(this.scope).find((k) => k.toLowerCase() === t.value.toLowerCase());
        return key !== undefined ? this.scope[key] : 0;
      }
      this.next(); // consume "("
      const args = this.args();
      return this.callFunction(t.value.toLowerCase(), t.value, args);
    }
    throw new Error('Unexpected token in expression');
  }

  private callFunction(name: string, raw: string, args: FormulaValue[]): FormulaValue {
    switch (name) {
      case 'fx': {
        const out = this.fx(asNum(args[0] ?? 0), asStr(args[1] ?? ''), asStr(args[2] ?? ''), args[3] === undefined ? undefined : asNum(args[3]));
        if (Number.isNaN(out)) throw new Error('fx: no rate for that currency yet');
        return out;
      }
      case 'if':
        return truthy(args[0] ?? 0) ? (args[1] ?? 0) : (args[2] ?? 0);
      // --- spreadsheet conditionals + text ------------------------------------
      // A range flattens into its cells before evaluation, so the criterion is
      // the LAST argument: sumif(A1:A9, ">5") arrives as sumif(a1..a9, ">5").
      // Excel's three-argument SUMIF(range, criterion, sum_range) is therefore
      // not supported, which the help text says out loud.
      case 'sumif':
      case 'countif':
      case 'averageif': {
        if (args.length < 2) return 0;
        const criterion = args[args.length - 1];
        const hits = args.slice(0, -1).filter((v) => matchCriterion(v, criterion));
        if (name === 'countif') return hits.length;
        const total = hits.reduce<number>((s, v) => s + asNum(v), 0);
        return name === 'sumif' ? total : hits.length ? total / hits.length : 0;
      }
      case 'counta':
        return args.filter((v) => (typeof v === 'string' ? v.trim() !== '' : true)).length;
      // ifs(cond, value, cond, value, ..., [fallback]) picks the first true one.
      case 'ifs': {
        for (let i = 0; i + 1 < args.length; i += 2) if (truthy(args[i])) return args[i + 1];
        return args.length % 2 === 1 ? (args[args.length - 1] ?? 0) : 0;
      }
      // switch(value, match, result, ..., [fallback])
      case 'switch': {
        const subject = args[0] ?? 0;
        for (let i = 1; i + 1 < args.length; i += 2) if (asStr(args[i]).toLowerCase() === asStr(subject).toLowerCase()) return args[i + 1];
        return args.length % 2 === 0 ? (args[args.length - 1] ?? 0) : 0;
      }
      case 'xor':
        return args.filter((v) => truthy(v)).length % 2 === 1 ? 1 : 0;
      case 'mid': {
        const s = asStr(args[0] ?? '');
        const start = Math.max(1, Math.round(asNum(args[1] ?? 1)));
        return s.slice(start - 1, start - 1 + Math.max(0, Math.round(asNum(args[2] ?? 0))));
      }
      case 'find': {
        // 1-based like a spreadsheet, 0 when absent (rather than -1).
        const at = asStr(args[1] ?? '').toLowerCase().indexOf(asStr(args[0] ?? '').toLowerCase());
        return at < 0 ? 0 : at + 1;
      }
      case 'substitute':
        return asStr(args[0] ?? '').split(asStr(args[1] ?? '')).join(asStr(args[2] ?? ''));
      case 'rept':
        return asStr(args[0] ?? '').repeat(Math.max(0, Math.min(1000, Math.round(asNum(args[1] ?? 0)))));
      case 'proper':
        return asStr(args[0] ?? '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case 'concat':
        return args.map(asStr).join('');
      case 'today':
        return Math.floor(Date.now() / 86400000);
      case 'days':
        return asNum(args[0] ?? 0) - asNum(args[1] ?? 0);
      // Swedish working days / days off between two dates (day-indices, e.g.
      // today() and a date column). workdays counts Mon-Fri minus red days;
      // daysoff counts weekends plus red days; together they sum to the span.
      case 'workdays':
        return countWorkdays(asNum(args[0] ?? 0), asNum(args[1] ?? 0));
      case 'daysoff':
      case 'reddays':
        return countDaysOff(asNum(args[0] ?? 0), asNum(args[1] ?? 0));
      case 'holiday':
        return isHoliday(asNum(args[0] ?? 0)) ? 1 : 0;
      // Values that widgets on the page publish, read by name. countdown("X") is a
      // counter's days-to-go; budget("X") is a budget's total spent; owed("X",
      // "Alice") is what that person's net is in budget X (negative means they owe).
      case 'countdown': {
        const name = asStr(args[0] ?? '');
        const v = lookupRef('countdown:', name);
        if (v === undefined) throw new Error(`No countdown named "${name}" on this page`);
        return v;
      }
      case 'budget': {
        const name = asStr(args[0] ?? '');
        const v = lookupRef('budget:', name);
        if (v === undefined) throw new Error(`No budget named "${name}" on this page`);
        return v;
      }
      case 'owed': {
        const name = asStr(args[0] ?? '');
        const who = asStr(args[1] ?? '');
        const v = lookupRef('owed:', `${name}|${who}`);
        if (v === undefined) throw new Error(`No one named "${who}" in budget "${name}"`);
        return v;
      }
      // Aggregates another table publishes by name: row count, or the total of one
      // of its number/formula columns. The table has to be on a page you have open.
      case 'tablecount': {
        const name = asStr(args[0] ?? '');
        const v = lookupRef('tablecount:', name);
        if (v === undefined) throw new Error(`No table named "${name}" is open`);
        return v;
      }
      case 'tablesum': {
        const name = asStr(args[0] ?? '');
        const col = asStr(args[1] ?? '');
        const v = lookupRef('tablesum:', `${name}|${col}`);
        if (v === undefined) throw new Error(`No column "${col}" on table "${name}"`);
        return v;
      }
      case 'format':
        return formatArg(args[0] ?? 0, asStr(args[1] ?? ''));
      // String built-ins live here, not in FUNCS, because they take/return text.
      case 'len':
        return asStr(args[0] ?? '').length;
      case 'lower':
        return asStr(args[0] ?? '').toLowerCase();
      case 'upper':
        return asStr(args[0] ?? '').toUpperCase();
      case 'contains':
        return asStr(args[0] ?? '').includes(asStr(args[1] ?? '')) ? 1 : 0;
      case 'startswith':
        return asStr(args[0] ?? '').startsWith(asStr(args[1] ?? '')) ? 1 : 0;
      case 'endswith':
        return asStr(args[0] ?? '').endsWith(asStr(args[1] ?? '')) ? 1 : 0;
      case 'trim':
        return asStr(args[0] ?? '').trim();
      case 'text':
        return asStr(args[0] ?? '');
      case 'left':
        return asStr(args[0] ?? '').slice(0, Math.max(0, Math.round(asNum(args[1] ?? 0))));
      case 'right': {
        const s = asStr(args[0] ?? '');
        const n = Math.max(0, Math.round(asNum(args[1] ?? 0)));
        return n === 0 ? '' : s.slice(-n);
      }
      case 'replace':
        return asStr(args[0] ?? '').split(asStr(args[1] ?? '')).join(asStr(args[2] ?? ''));
      // Logical helpers, all return 1/0 except coalesce (first non-empty value).
      case 'and':
        return args.length && args.every((a) => truthy(a)) ? 1 : 0;
      case 'or':
        return args.some((a) => truthy(a)) ? 1 : 0;
      case 'not':
        return truthy(args[0] ?? 0) ? 0 : 1;
      case 'isblank':
        return args[0] === undefined || asStr(args[0]) === '' ? 1 : 0;
      case 'coalesce':
      case 'default': {
        for (const a of args) if (asStr(a) !== '') return a;
        return '';
      }
      // Randomness only resolves where a caller deliberately injected an rng (a
      // roll, a /roll command, a flow action). In a formula *column* the rng is
      // undefined, so these throw and the column shows #ERR instead of silently
      // reshuffling on every render. Same "injected capability" shape as fx.
      case 'rand': {
        if (!this.rng) throw new Error('rand() only works in a roll, not a live column');
        const lo = Math.round(asNum(args[0] ?? 1));
        const hi = args[1] === undefined ? lo : Math.round(asNum(args[1]));
        const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
        return a + Math.floor(this.rng() * (b - a + 1));
      }
      case 'dice': {
        if (!this.rng) throw new Error('dice() only works in a roll, not a live column');
        return rollDice(asStr(args[0] ?? ''), this.rng);
      }
      case 'pick': {
        if (!this.rng) throw new Error('pick() only works in a roll, not a live column');
        return args.length ? args[Math.floor(this.rng() * args.length)] : 0;
      }
      default: {
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${raw}"`);
        return fn(args.map(asNum));
      }
    }
  }
}

// format(value, kind): dates from a day-index, or a currency/number format.
function formatArg(value: FormulaValue, kind: string): string {
  const k = kind.toLowerCase();
  if (k === 'date' || k === 'long' || k === 'iso' || k === 'weekday') {
    const d = dayToDate(asNum(value));
    if (k === 'iso') return d.toISOString().slice(0, 10);
    if (k === 'long') return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (k === 'weekday') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  return formatValue(asNum(value), k);
}

/** Evaluate a formula against a column-name -> value scope. Never throws. The
 *  `rng` is undefined for formula columns (so dice/rand/pick throw) and a real
 *  rng only on deliberate rolls, see callFunction. */
export function evaluateFormula(expression: string, scope: FormulaScope, fx: FxResolve = fxResolve, rng?: Rng): FormulaResult {
  if (!expression || !expression.trim()) return { ok: true, value: 0 };
  try {
    const tokens = tokenize(expression);
    const value = new Parser(tokens, scope, fx, rng).parse();
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
      return { ok: false, value: 0, error: 'Result is not a finite number' };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, value: 0, error: err instanceof Error ? err.message : 'Invalid formula' };
  }
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (Number.isInteger(n)) return n.toLocaleString();
  return Number(n.toFixed(4)).toLocaleString();
}

// Format a number per a column's chosen display format.
export function formatValue(n: number, format?: string): string {
  if (!Number.isFinite(n)) return '-';
  switch (format) {
    case 'comma':
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'yen':
      return '¥' + Math.round(n).toLocaleString();
    case 'sek':
      return n.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' kr';
    case 'eur':
      return '€' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'usd':
      return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'percent':
      return Number((n * 100).toFixed(2)).toLocaleString() + '%';
    case 'plain':
    default:
      return formatNumber(n);
  }
}

// Display a formula result: strings pass through; numbers use the column format.
export function formatFormulaValue(value: FormulaValue, numberFormat?: string): string {
  return typeof value === 'string' ? value : formatValue(value, numberFormat);
}
