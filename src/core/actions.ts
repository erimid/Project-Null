/**
 * Everything the player can do to the game goes through here as an
 * "action": a small plain object. The UI never changes GameState itself.
 * That keeps the rules in one place and makes them testable.
 */
import { SPEEDS, isConnected, type GameState, type Speed } from './state';

export type Action = { readonly type: 'setSpeed'; readonly speed: Speed };

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: ActionResult = { ok: true };
const refuse = (reason: string): ActionResult => ({ ok: false, reason });

export function applyAction(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'setSpeed': {
      if (!SPEEDS.includes(action.speed)) return refuse('Unknown speed.');
      if (isConnected(state)) return refuse('Time is locked while a connection is open.');
      state.clock.speed = action.speed;
      return OK;
    }
  }
}
