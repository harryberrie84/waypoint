import { convert } from './fx';

// ---------------------------------------------------------------------------
// settle, pure expense-split math for the budget summary. No React, no store:
// expenses + a member roster in, per-person balances and the transfer list out.
//
// "Who owes whom" is a cross-row, cross-person net over the whole table, not a
// rollup. Each expense credits its payer the full (base-converted) amount and
// debits each participant an equal share; netting those gives every person a
// single number (paid − owed). settleUp then collapses those into the fewest
// transfers that zero everyone out.
//
// Conversion goes through fx's convert(), settle never parses rates itself. A
// converter is injectable so tests can drive multi-currency without a network.
// ---------------------------------------------------------------------------

export interface Expense {
  amount: number;
  currency: string; // ISO code fx reads; '' falls back to the base (no conversion)
  paidBy: string; // user id, '' when unset
  splitAmong: string[]; // user ids; empty = split across everyone
}

export interface Transfer {
  from: string; // user id who pays
  to: string; // user id who receives
  amount: number; // unrounded base units, the block rounds for display
}

export type ConvertFn = (amount: number, from: string, to: string) => number;

// Net base-currency balance per member: positive = owed money, negative = owes.
// An expense whose conversion is unavailable (NaN, no rate yet) is skipped
// rather than poisoning every other row's total; the block counts and notes it.
// Unknown payer/participant ids (a since-deleted user) are dropped, never thrown.
export function netBalances(
  expenses: Expense[],
  members: string[],
  base: string,
  convertFn: ConvertFn = convert,
): Record<string, number> {
  const known = new Set(members);
  const balances: Record<string, number> = {};
  for (const id of members) balances[id] = 0;

  for (const e of expenses) {
    if (!known.has(e.paidBy)) continue; // can't attribute a ghost payer
    const inBase = e.currency && e.currency.toUpperCase() !== base.toUpperCase()
      ? convertFn(e.amount, e.currency, base)
      : e.amount;
    if (!Number.isFinite(inBase) || inBase === 0) continue; // missing rate, or nothing to split

    const named = e.splitAmong.filter((id) => known.has(id));
    // Empty (or all-since-deleted) "split among" means everyone shares it.
    const participants = named.length ? named : members;
    if (participants.length === 0) continue;

    const share = inBase / participants.length;
    balances[e.paidBy] += inBase;
    for (const p of participants) balances[p] -= share;
  }
  return balances;
}

// Greedy debt simplification: repeatedly settle the largest creditor against the
// largest debtor, emitting one transfer for the smaller magnitude. This
// minimizes the *count* of transfers, not a globally optimal partition (that's
// NP-hard and pointless at trip scale). Operates on unrounded balances so the
// emitted amounts conserve; the caller rounds only for display.
export function settleUp(balances: Record<string, number>): Transfer[] {
  const EPS = 1e-6;
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > EPS)
    .map(([id, v]) => ({ id, amt: v }));
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -EPS)
    .map(([id, v]) => ({ id, amt: -v })); // amt = how much they owe (positive)

  const transfers: Transfer[] = [];
  // Largest first so each step clears as much as possible.
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const pay = Math.min(c.amt, d.amt);
    if (pay > EPS) transfers.push({ from: d.id, to: c.id, amount: pay });
    c.amt -= pay;
    d.amt -= pay;
    if (c.amt <= EPS) ci++;
    if (d.amt <= EPS) di++;
  }
  return transfers;
}
