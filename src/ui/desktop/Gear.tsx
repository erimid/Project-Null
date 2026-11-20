/**
 * Small drawn pieces the shop, the Programs window and the Workbench
 * share: an icon on a lit tile, a row of pips, and a labelled bar.
 */
import type { ComponentChildren } from 'preact';
import { Icon, moduleIcon, type IconName } from './Icon';

/** An icon on a square tile. `tone` picks its colour: a module id, 'rare', 'good' or nothing for the usual cyan. */
export function IconTile({ icon, tone, size = 'md', children }: { icon: IconName; tone?: string; size?: 'sm' | 'md' | 'lg'; children?: ComponentChildren }) {
  return (
    <span class={`icontile icontile--${size}${tone ? ` tone--${tone}` : ''}`}>
      <Icon name={icon} size={size === 'lg' ? 30 : size === 'sm' ? 16 : 22} />
      {children}
    </span>
  );
}

/** A row of pips: `on` of `of` lit. For versions, grades and tiers. */
export function Pips({ on, of, label, class: extra }: { on: number; of: number; label: string; class?: string }) {
  return (
    <span class={`pips${extra ? ` ${extra}` : ''}`} role="img" aria-label={label}>
      {Array.from({ length: of }, (_, index) => (
        <i key={index} class={index < on ? 'is-on' : ''} />
      ))}
    </span>
  );
}

interface StatProps {
  label: string;
  /** How full the bar is, 0 to 1. */
  share: number;
  /** Where the player's own stands on the same bar, 0 to 1. Drawn as a tick. */
  mine?: number;
  /** The figure written after the bar. */
  value: string;
  /** Colours the bar: better or worse than the player's own. */
  tone?: 'better' | 'worse';
  tip?: string;
}

/** One figure as a bar, with a tick where the player's own stands. */
export function StatBar({ label, share, mine, value, tone, tip }: StatProps) {
  const percent = (part: number) => `${Math.round(Math.max(0, Math.min(1, part)) * 100)}%`;
  return (
    <div class={`stat${tone ? ` is-${tone}` : ''}`} title={tip}>
      <span class="stat__label">{label}</span>
      <span class="stat__bar" aria-hidden="true">
        <i class="stat__fill" style={{ width: percent(share) }} />
        {mine !== undefined && <i class="stat__mine" style={{ left: percent(mine) }} />}
      </span>
      <span class="stat__value data">{value}</span>
    </div>
  );
}

/** What a trait does, in the fewest words. */
export const TRAIT_WORDS: Record<string, string> = {
  quiet: 'Monitors do not notice it',
  tidy: 'Leaves no line in the log',
  parallel: 'Does not use up a program slot',
};

/** A module as a small plate: its colour, its icon and name, and a pip for each grade in the grade's own colour. */
export function ModulePlate({ module, grade, count, icon = true }: { module: { id: string; name: string; grades: readonly unknown[] }; grade: number; count?: number; icon?: boolean }) {
  return (
    <span class={`plate plate--${module.id} grade--${grade}`}>
      {icon && <Icon name={moduleIcon(module.id)} size={14} class="plate__icon" />}
      <span class="plate__name">{module.name}</span>
      <span class="plate__grade" aria-label={`grade ${grade}`}>
        {module.grades.map((_, index) => (
          <i key={index} class={index < grade ? 'is-on' : ''} />
        ))}
      </span>
      {count !== undefined && <span class="plate__count data">×{count}</span>}
    </span>
  );
}
