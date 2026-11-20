/** Turning game values into the text shown on screen. */
import type { GameDate } from '../core';
import { gameInfo } from '../content';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "2,500c" */
export function formatMoney(amount: number): string {
  return `${Math.floor(amount).toLocaleString('en-US')}${gameInfo.currencySuffix}`;
}

/** "08:00" */
export function formatTime(date: GameDate): string {
  return `${two(date.hours)}:${two(date.minutes)}`;
}

/** "14 Mar 2034" */
export function formatDay(date: GameDate): string {
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** "14 Mar 2034 08:00", from a game time in milliseconds. */
export function formatGameTime(gameTimeMs: number): string {
  const d = new Date(gameTimeMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** When a save was made, in the player's own time zone: "17 Nov, 22:14". */
export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "3 · Runner": the rating number and the title that goes with it. */
export function formatRating(rating: number): string {
  const title = [...gameInfo.ratings].reverse().find((level) => rating >= level.min)?.title ?? '';
  return `${rating} · ${title}`;
}

/** Where a rating sits on the ladder: its title, the next one, and how far along the step it is (0 to 1). */
export function ratingStep(rating: number): { title: string; next: { title: string; min: number } | null; share: number } {
  const ladder = gameInfo.ratings;
  const index = Math.max(0, ladder.findLastIndex((level) => rating >= level.min));
  const here = ladder[index]!;
  const next = ladder[index + 1] ?? null;
  return { title: here.title, next, share: next ? (rating - here.min) / (next.min - here.min) : 1 };
}

/** How one speed measures against another, in words: 2 -> "twice as fast", 1.4 -> "40% faster", 0.8 -> "20% slower". */
export function speedWord(times: number): string {
  if (times >= 1.95) {
    const whole = Math.round(times);
    if (Math.abs(times - whole) < 0.06) return whole === 2 ? 'twice as fast' : `${whole}× as fast`;
    return `${times.toFixed(1)}× as fast`;
  }
  if (times > 1.01) return `${Math.round((times - 1) * 100)}% faster`;
  if (times < 0.99) return `${Math.round((1 - times) * 100)}% slower`;
  return 'same speed';
}

/** A change in size with its sign: "+2 GB", "−3 GB". */
export const sizeChange = (gb: number): string => `${gb > 0 ? '+' : '−'}${Math.abs(Math.round(gb * 10) / 10)} GB`;

/** Seconds for a readout: "8s", "2.7s". */
export const formatSeconds = (value: number): string => `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)}s`;
