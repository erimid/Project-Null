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
