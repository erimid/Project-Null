import type { Action, Connection, GameState, ServerState, TaskTarget } from '../../../core';
import type { ServerDef } from '../../../core/content';

/** Everything a section of the Server window needs to show one connection. */
export interface View {
  game: GameState;
  server: ServerDef;
  state: ServerState;
  connection: Connection;
  /** Starts a program on this connection; any refusal is shown at the bottom of the window. */
  run: (target: TaskTarget) => void;
  /** Does anything else on this connection, with refusals shown the same way. True if it worked. */
  act: (action: Action) => boolean;
}
