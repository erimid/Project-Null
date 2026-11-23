import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, contrast, themeVars, toRgb } from './themes';

describe('colour themes', () => {
  it('has twenty themes with their own ids and names', () => {
    expect(THEMES).toHaveLength(20);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(20);
    expect(new Set(THEMES.map((theme) => theme.name)).size).toBe(20);
  });

  it('leaves the first theme exactly as the game was', () => {
    expect(THEMES[0]!.id).toBe(DEFAULT_THEME);
    expect(themeVars(THEMES[0]!)).toEqual({});
  });

  it('never uses the alarm colour as the accent', () => {
    for (const theme of THEMES) {
      expect(theme.alarm, theme.name).not.toBe(theme.accent);
      const [a, b] = [toRgb(theme.alarm), toRgb(theme.accent)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), theme.name).toBeGreaterThan(80);
    }
  });

  it('sets the same variables in every theme', () => {
    const keys = Object.keys(themeVars(THEMES[1]!)).sort();
    for (const theme of THEMES.slice(1)) expect(Object.keys(themeVars(theme)).sort(), theme.name).toEqual(keys);
  });

  it('keeps text readable on a window in every theme', () => {
    for (const theme of THEMES.slice(1)) {
      const vars = themeVars(theme);
      expect(contrast(vars['--text']!, theme.panel), `${theme.name} text`).toBeGreaterThanOrEqual(7);
      expect(contrast(vars['--text-muted']!, theme.panel), `${theme.name} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars['--text-dim']!, theme.panel), `${theme.name} dim`).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.accent, theme.panel), `${theme.name} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.alarm, theme.panel), `${theme.name} alarm`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars['--on-cyan']!, theme.accent), `${theme.name} button text`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
