/**
 * Skills the player presses a button for. Each is learned in the skill
 * tree and then works once on every connection:
 *
 * - Overclock (Intrusion): every program running on the connection goes
 *   twice as fast for ten seconds, and the monitor notices at once.
 * - False trail (Ghost): a running trace chases a decoy and loses the
 *   step it was on and the one before.
 * - Hot patch (Engineering): one loaded program is rebuilt in place to
 *   match the layer in front of it, at the cost of a module off the shelf.
 */
import type { SkillEffect } from '../content/skills';
import { addParts } from './crafting';
import { monitorHeld } from './link';
import { effect } from './skills';
import type { Connection, GameState, MoveId, PatchLayer } from './state';
import { traceReport } from './trace';
import { findConnection, findServer, ownedProgram, securityOf, type Content } from './world';

export const MOVES: readonly MoveId[] = ['overclock', 'falseTrail', 'hotPatch'];

/** The skill effect that teaches each move. */
export const MOVE_EFFECT: Record<MoveId, SkillEffect> = { overclock: 'surge', falseTrail: 'falseTrail', hotPatch: 'hotPatch' };
export const MOVE_NAMES: Record<MoveId, string> = { overclock: 'Overclock', falseTrail: 'False trail', hotPatch: 'Hot patch' };

/** Seconds an Overclock lasts, and how much faster programs run meanwhile. */
export const SURGE_SECONDS = 10;
export const SURGE_SPEED = 2;

const PATCH_KIND = { password: 'breakPassword', proxy: 'bypassProxy', firewall: 'bypassFirewall', monitor: 'bypassMonitor' } as const;
export const PATCH_LAYERS: readonly PatchLayer[] = ['password', 'proxy', 'firewall', 'monitor'];

/** True if the player has learned a move. */
export const knowsMove = (state: GameState, content: Content, move: MoveId): boolean => effect(state, content, MOVE_EFFECT[move]) > 0;

/** How many times a move can still be used on a connection. 0 if it was never learned. */
export function movesLeft(state: GameState, content: Content, connection: Connection, move: MoveId): number {
  if (!knowsMove(state, content, move)) return 0;
  return Math.max(0, 1 + effect(state, content, 'doubleTap') - (connection.moves?.[move] ?? 0));
}

/** The cheapest module on the shelf: what a Hot patch uses up. */
export function patchModule(state: GameState): { id: string; grade: number } | undefined {
  return Object.entries(state.player.parts)
    .filter(([, held]) => held > 0)
    .map(([key]) => ({ id: key.split(':')[0]!, grade: Number(key.split(':')[1]) }))
    .sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id))[0];
}

/** Why a move can't be used on a connection right now, or null if it can. `layer` is what a Hot patch is for. */
export function whyNotMove(state: GameState, content: Content, connectionId: string, move: MoveId, layer?: PatchLayer): string | null {
  const connection = findConnection(state, connectionId);
  const server = connection && findServer(content, connection.serverId);
  if (!connection || !server) return 'That connection is closed.';
  if (!knowsMove(state, content, move)) return `You have not learned ${MOVE_NAMES[move]}.`;
  if (movesLeft(state, content, connection, move) <= 0) return `${MOVE_NAMES[move]} is spent on this connection. Reconnect to use it again.`;
  if (move === 'overclock') {
    if (!state.tasks.some((task) => task.connectionId === connection.id)) return 'Nothing is running on this connection to speed up.';
    if ((connection.surgeMs ?? 0) > 0) return 'The processor is already overclocked.';
    return null;
  }
  if (move === 'falseTrail') {
    if (connection.trace.status !== 'active') return 'There is no trace to send the wrong way.';
    if (connection.trace.elapsedMs <= 0) return 'The trace has not got anywhere yet.';
    return null;
  }
  if (layer === undefined || !PATCH_LAYERS.includes(layer)) return 'Pick the layer to patch for.';
  const level = securityOf(state, server)[layer];
  const program = ownedProgram(state, content, PATCH_KIND[layer]);
  if (!program) return 'You have no program in memory for that layer.';
  if (connection.patched === layer) return 'That program is already patched for this layer.';
  if (level <= program.version) return `${program.name} is already a match for this ${layer}.`;
  if (state.tasks.some((task) => task.connectionId === connection.id && task.programId === program.id)) return `${program.name} is running. Stop it first.`;
  if (!patchModule(state)) return 'A Hot patch uses up a module, and your shelf is empty.';
  return null;
}

/** Uses a move on a connection. Returns a reason if it can't be done. */
export function useMove(state: GameState, content: Content, connectionId: string, move: MoveId, layer?: PatchLayer): string | null {
  const reason = whyNotMove(state, content, connectionId, move, layer);
  if (reason !== null) return reason;
  const connection = findConnection(state, connectionId)!;
  connection.moves = { ...connection.moves, [move]: (connection.moves?.[move] ?? 0) + 1 };
  if (move === 'overclock') {
    connection.surgeMs = SURGE_SECONDS * 1000;
    // The fans are loud: whoever is watching looks up at once, unless nobody can.
    const server = findServer(content, connection.serverId);
    if (!server?.untraced && !monitorHeld(state, content, connection)) {
      connection.monitor.blindMs = 0;
      connection.monitor.echo = null;
      connection.trace.status = 'active';
      connection.trace.graceMs = 0;
    }
  } else if (move === 'falseTrail') {
    const trace = connection.trace;
    const back = Math.max(0, traceReport(trace).relaysTraced - 1);
    trace.elapsedMs = trace.hopMs.slice(0, back).reduce((sum, ms) => sum + ms, 0);
  } else {
    const module = patchModule(state)!;
    addParts(state, module.id, module.grade, -1);
    connection.patched = layer!;
  }
  return null;
}
