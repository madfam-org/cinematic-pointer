/**
 * Pointer outfits
 *
 * The shapes the pointer can wear. Each is our own drawing on a 32 by 32 grid, with a hotspot: the
 * grid point that sits exactly on the thing being pointed at. An outfit is plain SVG markup that
 * takes its colours from two custom properties, `--cp-ink` (the line) and `--cp-fill` (the body), so
 * a persona can dress it without redrawing it.
 */

export type OutfitId = 'arrow' | 'point' | 'press' | 'text' | 'wait' | 'move' | 'inspect' | 'frame';

export interface Outfit {
  id: OutfitId;
  /** What the shape says the pointer is doing. */
  label: string;
  /** Grid point that lands on the target. */
  hotspot: { x: number; y: number };
  /** SVG markup inside the 32 by 32 view box. */
  body: string;
}

const HAND =
  'M12 4.5a2.5 2.5 0 0 1 5 0V14l6.2 1.3a3 3 0 0 1 2.4 3.3l-.9 6.2A4 4 0 0 1 20.7 28h-5.3' +
  'a4 4 0 0 1-3.2-1.6L7 19.6a2.2 2.2 0 0 1 3.3-2.9l1.7 1.6z';

const solid = (d: string) =>
  `<path d="${d}" fill="var(--cp-fill)" stroke="var(--cp-ink)" stroke-width="1.6" stroke-linejoin="round"/>`;
const line = (d: string, width = 2) =>
  `<path d="${d}" fill="none" stroke="var(--cp-fill)" stroke-width="${width + 2.2}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="var(--cp-ink)" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const OUTFITS: Record<OutfitId, Outfit> = {
  arrow: {
    id: 'arrow',
    label: 'travelling',
    hotspot: { x: 6, y: 3 },
    body: solid('M6 3V25l5.5-5 3.5 8 3.5-1.5-3.5-7.5h8z'),
  },
  point: {
    id: 'point',
    label: 'about to act',
    hotspot: { x: 14.5, y: 2.5 },
    body: solid(HAND),
  },
  press: {
    id: 'press',
    label: 'acting',
    hotspot: { x: 14.5, y: 4.5 },
    body:
      `<g transform="translate(0 2)">${solid(HAND)}</g>` +
      line('M8.5 5.5 6 3M20.5 5.5 23 3M14.5 2.4V.8', 1.4),
  },
  text: {
    id: 'text',
    label: 'reading or writing',
    hotspot: { x: 16, y: 16 },
    body: line(
      'M11 4h3a2 2 0 0 1 2 2 2 2 0 0 1 2-2h3M16 6v20M11 28h3a2 2 0 0 0 2-2 2 2 0 0 0 2 2h3',
    ),
  },
  wait: {
    id: 'wait',
    label: 'waiting',
    hotspot: { x: 16, y: 16 },
    body: line('M9 4h14M9 28h14M11 4v4c0 4 5 5 5 8s-5 4-5 8v4M21 4v4c0 4-5 5-5 8s5 4 5 8v4', 1.8),
  },
  move: {
    id: 'move',
    label: 'dragging',
    hotspot: { x: 16, y: 16 },
    body: solid('M16 3 12 7h3v8H7v-3l-4 4 4 4v-3h8v8h-3l4 4 4-4h-3v-8h8v3l4-4-4-4v3h-8V7h3z'),
  },
  inspect: {
    id: 'inspect',
    label: 'inspecting',
    hotspot: { x: 16, y: 16 },
    body: line('M16 7a9 9 0 1 0 0 18 9 9 0 1 0 0-18M16 3v8M16 21v8M3 16h8M21 16h8', 1.6),
  },
  frame: {
    id: 'frame',
    label: 'framing',
    hotspot: { x: 16, y: 16 },
    body: line('M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6M16 13v6M13 16h6', 1.8),
  },
};

export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[];

/** One outfit as a standalone SVG element, `size` frame pixels on a side. */
export function outfitSvg(id: OutfitId, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" ` +
    `data-outfit="${id}">${OUTFITS[id].body}</svg>`
  );
}
