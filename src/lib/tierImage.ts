// Layout for "save the tier list as an image".
//
// A tier list is the one thing on the page people want to send somebody who is
// not in the workspace, and a screenshot always cuts off the bottom band. This
// works out where every band and every card goes on a fixed-width canvas; the
// drawing itself is a few canvas calls in the editor, which keeps the arithmetic
// (the part that gets the bottom row wrong) here where it is tested.
//
// No DOM, no React.

import type { TierRow } from './tierList';

export const TIER_IMAGE_WIDTH = 1200;

const CELL = 104; // card side
const GAP = 6;
const PAD = 10;
const LABEL_W = 132;
const HEADER_H = 64;
const FOOTER_H = 34;
const CAPTION_H = 20; // the name under a card

export interface PlacedCard {
  id: string;
  text: string;
  image: string;
  x: number;
  y: number;
  size: number;
}

export interface PlacedBand {
  label: string;
  color: string;
  y: number;
  height: number;
  cards: PlacedCard[];
}

export interface TierImageLayout {
  width: number;
  height: number;
  headerHeight: number;
  labelWidth: number;
  bands: PlacedBand[];
}

/** How many cards fit on one line of a band. At least one, so a narrow canvas
 *  still lays out (one card per line) instead of dividing by zero. */
export function cardsPerLine(width = TIER_IMAGE_WIDTH): number {
  return Math.max(1, Math.floor((width - LABEL_W - PAD) / (CELL + GAP)));
}

/** Place every band and card for `rows` (the same rows the editor renders, in the
 *  same order). Bands wrap onto extra lines rather than overflowing, and an empty
 *  band still gets one line's height so the colour stripe reads as a real tier. */
export function layoutTierImage(rows: TierRow[], width = TIER_IMAGE_WIDTH): TierImageLayout {
  const perLine = cardsPerLine(width);
  const bands: PlacedBand[] = [];
  let y = HEADER_H;

  for (const row of rows) {
    const lines = Math.max(1, Math.ceil(row.items.length / perLine));
    const height = lines * (CELL + CAPTION_H + GAP) + PAD;
    const cards: PlacedCard[] = row.items.map((it, i) => ({
      id: it.id,
      text: it.text,
      image: it.image,
      x: LABEL_W + PAD + (i % perLine) * (CELL + GAP),
      y: y + PAD / 2 + Math.floor(i / perLine) * (CELL + CAPTION_H + GAP),
      size: CELL,
    }));
    bands.push({
      label: row.tier?.label ?? 'Unranked',
      color: row.tier?.color ?? '#8a94a6',
      y,
      height,
      cards,
    });
    y += height + 2; // 2px hairline between bands, same as the on-screen gap
  }

  return { width, height: y + FOOTER_H, headerHeight: HEADER_H, labelWidth: LABEL_W, bands };
}

/** A filename that survives a Downloads folder: the list's own title when it has
 *  one, dated, and stripped of anything a filesystem would object to. */
export function tierImageFilename(title: string, onIso: string): string {
  const base = (title || 'tier-list').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  return `${base || 'tier-list'}-${onIso.slice(0, 10)}.png`;
}
