/**
 * Property: what a long career buys once the gateway is built. Three
 * things to begin with, sold by the broker on a board's Hardware shelf, each bought
 * once and kept for good:
 *
 * - a private relay: a relay of the player's own, which never warms up;
 * - a safe house: half the time lying low after a trace, heat that fades
 *   twice as fast, and no part burned out of the gateway by a trace;
 * - a second gateway: one more connection, two more programs at once and
 *   16 GB more memory.
 *
 * And three for the money a finished career piles up, each of which changes
 * what the player can do:
 *
 * - a core loft: the hands-on shortcuts play themselves (see play.ts);
 * - a night desk: the player's lines are scrubbed when they leave a server;
 * - a cut-out: once a game day, a trace that gets home costs nothing but
 *   the connection.
 *
 * This file reads no other rules, so any of them can ask it what the
 * player owns.
 */
import type { AssetDef, AssetEffect } from '../content/assets';
import type { GameState } from './state';

/** The part of the game's data this file reads. */
interface Holds {
  readonly assets?: readonly AssetDef[];
}

/** What a second gateway adds. */
export const SECOND_GATEWAY = { connections: 1, programs: 2, memoryGb: 16 } as const;
/** A safe house: lying low lasts this share of the usual, and heat fades this many times as fast. */
export const SAFE_HOUSE = { lieLow: 0.5, cool: 2 } as const;

export const findAsset = (content: Holds, id: string): AssetDef | undefined => content.assets?.find((asset) => asset.id === id);

/** True if the player owns a property with this effect. */
export function hasAsset(state: GameState, content: Holds, effect: AssetEffect): boolean {
  return (state.player.assets ?? []).some((id) => findAsset(content, id)?.effect === effect);
}

/** True for the relay that came with a private relay the player bought. */
export function ownRelay(state: GameState, content: Holds, serverId: string): boolean {
  return (state.player.assets ?? []).some((id) => findAsset(content, id)?.serverId === serverId);
}

/** Why the broker will not sell this right now, leaving money aside. Null if they will. */
export function whyNotAsset(state: GameState, content: Holds, assetId: string): string | null {
  const asset = findAsset(content, assetId);
  if (!asset) return 'That is not for sale.';
  if (state.player.assets.includes(asset.id)) return 'You already own it.';
  if (state.player.rating < asset.minRating) return `The broker deals with names they know. Come back with a rating of ${asset.minRating}.`;
  return null;
}
