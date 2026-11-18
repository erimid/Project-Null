/**
 * content/ holds the game's data as JSON: servers, programs, contracts and
 * so on. Code elsewhere imports data through this file, never the JSON
 * files directly, so each data file gets a type and a check in one place.
 */
import gameJson from './game.json';

export interface GameInfo {
  /** Working title shown in the UI. */
  readonly title: string;
  /** Player handle used until the player picks one. */
  readonly defaultHandle: string;
  /** Letter shown after money amounts, e.g. "12,880c". */
  readonly currencySuffix: string;
}

export const gameInfo: GameInfo = gameJson;
