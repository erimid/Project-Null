/**
 * content/ holds the game's data as JSON: servers, tuning numbers, and
 * later programs and contracts. Code elsewhere imports data through this
 * file, never the JSON files directly, so every file is checked once here.
 */
import gameJson from './game.json';
import serversJson from './servers.json';
import tuningJson from './tuning.json';
import { parseGameInfo, parseServers, parseTuning } from './schema';

export type { GameInfo, ServerDef, ServerKind, Tuning } from './schema';

export const gameInfo = parseGameInfo(gameJson);
export const tuning = parseTuning(tuningJson);
export const servers = parseServers(serversJson);
