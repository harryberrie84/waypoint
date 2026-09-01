// ---------------------------------------------------------------------------
// Avatar helpers, initials + a stable colour keyed off a seed (a user id).
// ---------------------------------------------------------------------------
// We have no avatar storage, so members render as a colour-coded initials chip.
// The colour is derived from the id so a person looks the same everywhere they
// appear (presence bar, person cells, the bell). Shared so those don't drift.

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A stable HEX colour for a seed (a user id). Hex, not hsl, so it also works
// where an alpha suffix is appended (`${color}70` for the collaboration-cursor
// selection). Same hue/sat/light as before, so existing chips look unchanged.
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return hslToHex(h, 45, 45);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c);
  };
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}
