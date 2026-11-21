/**
 * Conditions: something about the game so far, for content that should
 * only appear, or only take a side, in some stories. Used by contracts
 * (`when`), heist allies and the story director.
 */
import type { ConditionDef } from '../content/schema';
import { DEFAULT_CHOICE, standingWith } from './patrons';
import type { GameState } from './state';

/** True if every part of a condition holds. No condition holds always. */
export function conditionMet(state: GameState, condition: ConditionDef | undefined): boolean {
  if (!condition) return true;
  if (condition.flags?.some((flag) => !state.flags.includes(flag))) return false;
  if (condition.notFlags?.some((flag) => state.flags.includes(flag))) return false;
  if (Object.entries(condition.standing ?? {}).some(([id, least]) => standingWith(state, id) < least)) return false;
  if (Object.entries(condition.below ?? {}).some(([id, most]) => standingWith(state, id) > most)) return false;
  if (Object.entries(condition.choices ?? {}).some(([id, choice]) => (state.patrons.choices[id] ?? (state.contracts.completed.includes(id) ? DEFAULT_CHOICE : undefined)) !== choice)) return false;
  return true;
}
