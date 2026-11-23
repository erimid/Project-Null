/**
 * The colour themes. A theme is seven colours; every other colour on the desk
 * (borders, dim text, deep tints, glows) is worked out from those seven, so a
 * theme can never leave a corner of the game in the old colours.
 *
 * Rules: the alarm colour is never the accent colour (a trace must never look
 * like ordinary chrome), and the story's violet is not part of any theme.
 */

export interface Theme {
  readonly id: string;
  readonly name: string;
  /** A few words shown under the name in the picker. */
  readonly note: string;
  /** The desk behind the windows. */
  readonly bg: string;
  /** A window's own surface. */
  readonly panel: string;
  readonly text: string;
  /** Borders, titles, buttons, the globe. */
  readonly accent: string;
  /** Done, safe, credits. */
  readonly good: string;
  /** Careful: heat, deadlines. */
  readonly warn: string;
  /** Traces and anything lost. */
  readonly alarm: string;
  readonly light?: boolean;
}

export const DEFAULT_THEME = 'deep-signal';

export const THEMES: readonly Theme[] = [
  { id: 'deep-signal', name: 'Deep Signal', note: 'The original', bg: '#03080f', panel: '#06111d', text: '#a9dcef', accent: '#5fd4ff', good: '#4ee6c8', warn: '#ffc45c', alarm: '#ff3b4e' },
  { id: 'phosphor', name: 'Phosphor', note: 'Green screen', bg: '#020502', panel: '#061006', text: '#86e496', accent: '#39ff6a', good: '#a8ff60', warn: '#ffd75a', alarm: '#ff5a4f' },
  { id: 'amber-terminal', name: 'Amber Terminal', note: 'Warm monochrome', bg: '#0a0600', panel: '#140d02', text: '#e0b060', accent: '#ffb000', good: '#ffe08a', warn: '#ff8a3d', alarm: '#ff5a5a' },
  { id: 'ice-station', name: 'Ice Station', note: 'Pale and cold', bg: '#07101a', panel: '#0e1c2b', text: '#c9dceb', accent: '#a9e4ff', good: '#7df0c8', warn: '#ffd08a', alarm: '#ff6b81' },
  { id: 'ultraviolet', name: 'Ultraviolet', note: 'Purple night', bg: '#0b0516', panel: '#140a25', text: '#d8caf2', accent: '#c59bff', good: '#5ff0e0', warn: '#ffc857', alarm: '#ff6480' },
  { id: 'synthwave', name: 'Synthwave', note: 'Pink and teal', bg: '#120422', panel: '#1d0a36', text: '#f0c8f4', accent: '#ff4fd8', good: '#37e8ff', warn: '#ffd447', alarm: '#ff6a5a' },
  { id: 'blood-moon', name: 'Blood Moon', note: 'Red, yellow alarms', bg: '#100404', panel: '#1c0909', text: '#eac4bc', accent: '#ff6a4a', good: '#ffb38a', warn: '#ffd166', alarm: '#fff06a' },
  { id: 'gold-standard', name: 'Gold Standard', note: 'Black and gold', bg: '#0a0906', panel: '#15130d', text: '#d9cfb4', accent: '#e6c15a', good: '#b9e08a', warn: '#ff9d5c', alarm: '#ff6464' },
  { id: 'daylight', name: 'Daylight', note: 'Light', bg: '#e4eaf0', panel: '#ffffff', text: '#33475a', accent: '#0a6fc2', good: '#0b7d62', warn: '#a85a00', alarm: '#c62839', light: true },
  { id: 'paper', name: 'Paper', note: 'Light, ink on cream', bg: '#e6dcc8', panel: '#f8f2e4', text: '#4a3f2f', accent: '#23587c', good: '#46691f', warn: '#99590a', alarm: '#b3261e', light: true },
  { id: 'midnight-oil', name: 'Midnight Oil', note: 'Grey and amber', bg: '#0b0c0f', panel: '#14161b', text: '#c5cad6', accent: '#ffb000', good: '#62d48f', warn: '#ffd166', alarm: '#ff6b6b' },
  { id: 'toxic', name: 'Toxic', note: 'Acid green', bg: '#070b05', panel: '#0f160b', text: '#c9dbb4', accent: '#b6ff3a', good: '#6af0c0', warn: '#ffcc4d', alarm: '#ff5fae' },
  { id: 'rose-quartz', name: 'Rose Quartz', note: 'Soft pink', bg: '#140a10', panel: '#1f111a', text: '#ecd0dc', accent: '#ff9ec4', good: '#9be8d0', warn: '#ffd08a', alarm: '#ff5f6e' },
  { id: 'deep-sea', name: 'Deep Sea', note: 'Teal depths', bg: '#021012', panel: '#06201f', text: '#a9d6d0', accent: '#2fe0c8', good: '#8fe88a', warn: '#ffc46b', alarm: '#ff6f7d' },
  { id: 'graphite', name: 'Graphite', note: 'Quiet greys', bg: '#0e0f11', panel: '#18191c', text: '#b9bcc4', accent: '#eceef2', good: '#9fd6a8', warn: '#e8c170', alarm: '#f07070' },
  { id: 'solar-flare', name: 'Solar Flare', note: 'Orange heat', bg: '#100801', panel: '#1c1004', text: '#f0d2b0', accent: '#ff8a1f', good: '#ffe066', warn: '#ffb38a', alarm: '#ff4d6d' },
  { id: 'mint-chip', name: 'Mint Chip', note: 'Cool mint', bg: '#06100d', panel: '#0c1c17', text: '#bfe6d8', accent: '#7dffcf', good: '#c8f56a', warn: '#ffcf70', alarm: '#ff6f91' },
  { id: 'dusk', name: 'Dusk', note: 'Indigo evening', bg: '#0d0a24', panel: '#16123a', text: '#d3d4f2', accent: '#7de3e0', good: '#8cf0b4', warn: '#ffcf70', alarm: '#ff7d98' },
  { id: 'high-contrast', name: 'High Contrast', note: 'Maximum legibility', bg: '#000000', panel: '#0a0a0a', text: '#ffffff', accent: '#ffff00', good: '#00ffb0', warn: '#ffb000', alarm: '#ff5050' },
  { id: 'colour-blind-safe', name: 'Colour-blind Safe', note: 'Blue, yellow, orange', bg: '#06101c', panel: '#0c1b2e', text: '#cfe0f0', accent: '#56b4e9', good: '#f0e442', warn: '#e69f00', alarm: '#ff7a33' },
];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}

type Rgb = readonly [number, number, number];

export function toRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `b` stirred into `a`: 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, amount: number): string {
  const from = toRgb(a);
  const to = toRgb(b);
  return toHex([0, 1, 2].map((index) => from[index]! + (to[index]! - from[index]!) * amount) as unknown as Rgb);
}

function channel(value: number): number {
  const part = value / 255;
  return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The usual contrast ratio, 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function triplet(hex: string): string {
  return toRgb(hex).join(' ');
}

/** Text that reads on a solid block of `colour`. */
function ink(colour: string): string {
  return luminance(colour) > 0.3 ? mix(colour, '#000000', 0.88) : '#ffffff';
}

/**
 * Every CSS variable a theme sets. The first theme sets none: its values are
 * the ones written in theme.css, so the game looks as it always has.
 */
export function themeVars(theme: Theme): Record<string, string> {
  if (theme.id === DEFAULT_THEME) return {};
  const { bg, panel, text, accent, good, warn, alarm } = theme;
  const light = theme.light === true;
  const pole = light ? '#000000' : '#ffffff';
  const bright = mix(text, pole, 0.6);
  const muted = mix(text, panel, light ? 0.14 : 0.2);
  const deep = (colour: string) => mix(bg, colour, light ? 0.16 : 0.14);
  const bar = toRgb(mix(bg, panel, 0.5)).join(', ');
  return {
    'color-scheme': light ? 'light' : 'dark',
    '--bg': bg,
    '--bg-rgb': triplet(bg),
    '--bg-glow': mix(bg, accent, light ? 0.1 : 0.13),
    '--bar': `rgba(${bar}, 0.94)`,
    '--panel': panel,
    '--panel-rgb': triplet(panel),
    '--panel-hi': mix(panel, accent, 0.07),
    '--panel-hi2': mix(panel, accent, 0.16),
    '--cyan': accent,
    '--cyan-rgb': triplet(accent),
    '--cyan-hi': mix(accent, pole, 0.25),
    '--cyan-low': mix(accent, bg, 0.35),
    '--on-cyan': ink(accent),
    '--text-bright': bright,
    '--bright-rgb': triplet(bright),
    '--text': text,
    '--text-muted': muted,
    '--muted-rgb': triplet(muted),
    '--text-dim': mix(text, panel, light ? 0.3 : 0.4),
    '--text-faint': mix(text, panel, light ? 0.5 : 0.6),
    '--mint': good,
    '--mint-rgb': triplet(good),
    '--mint-text': mix(good, pole, light ? 0.35 : 0.6),
    '--mint-deep': deep(good),
    '--mint-deep-rgb': triplet(deep(good)),
    '--on-mint': ink(good),
    '--red': alarm,
    '--red-rgb': triplet(alarm),
    '--red-text': mix(alarm, pole, light ? 0.35 : 0.65),
    '--red-text-rgb': triplet(mix(alarm, pole, light ? 0.35 : 0.65)),
    '--red-soft': mix(alarm, pole, light ? 0.15 : 0.35),
    '--red-muted': mix(alarm, panel, 0.4),
    '--red-deep': deep(alarm),
    '--red-deep-rgb': triplet(deep(alarm)),
    '--amber': warn,
    '--amber-rgb': triplet(warn),
    '--amber-text': mix(warn, pole, light ? 0.3 : 0.4),
    '--amber-text-rgb': triplet(mix(warn, pole, light ? 0.3 : 0.4)),
    '--amber-deep': deep(warn),
    '--amber-deep-rgb': triplet(deep(warn)),
  };
}
