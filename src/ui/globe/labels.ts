/**
 * Finding room for the words on the globe. Each label offers a few places
 * it could go; they are handed out in order, and a label with nowhere
 * clear to go is left off rather than written over another. Pure maths,
 * no drawing.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LabelAsk {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** Places its centre could go, best first. */
  readonly spots: readonly { readonly x: number; readonly y: number }[];
}

const overlaps = (a: Box, b: Box, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

const inside = (box: Box, bounds: Box) => box.x >= bounds.x && box.y >= bounds.y && box.x + box.w <= bounds.x + bounds.w && box.y + box.h <= bounds.y + bounds.h;

/**
 * Gives each label the first of its spots that is inside `bounds` and
 * clear of `blocked` and of every label placed before it. Earlier labels
 * win, so list the ones that matter most first. Returns each placed
 * label's centre, by id.
 */
export function placeLabels(asks: readonly LabelAsk[], blocked: readonly Box[], bounds: Box, gap = 2): Map<string, { x: number; y: number }> {
  const taken: Box[] = [...blocked];
  const placed = new Map<string, { x: number; y: number }>();
  for (const ask of asks) {
    for (const spot of ask.spots) {
      const box = { x: spot.x - ask.w / 2, y: spot.y - ask.h / 2, w: ask.w, h: ask.h };
      if (!inside(box, bounds) || taken.some((other) => overlaps(box, other, gap))) continue;
      taken.push(box);
      placed.set(ask.id, spot);
      break;
    }
  }
  return placed;
}

/** A box of the given size centred on a point. */
export const boxAround = (x: number, y: number, w: number, h = w): Box => ({ x: x - w / 2, y: y - h / 2, w, h });
