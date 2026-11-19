/**
 * A rented language model: paid for by the day on the board, it takes
 * some of the reading, checking and watching off the player's hands.
 */
import type { ModelDef, ModelSkill } from '../content/models';
import { hostedModel } from './hardware';
import { shopOf, shopPrice } from './market';
import { readEverything } from './phish';
import type { Connection, GameState } from './state';
import { traceHeld, traceReport } from './trace';
import { findConnection, findServer, sendMail, type Content } from './world';

export const findModel = (content: Content, id: string): ModelDef | undefined => content.models.find((model) => model.id === id);

/** The model the player is renting right now, if any. */
export function rentedModel(state: GameState, content: Content): ModelDef | undefined {
  const rental = state.player.model;
  return rental && rental.untilMs > state.clock.gameTimeMs ? findModel(content, rental.id) : undefined;
}

/** Every model working for the player: the one on the gateway's own rack, and the one rented. */
export function workingModels(state: GameState, content: Content): ModelDef[] {
  return [hostedModel(state, content), rentedModel(state, content)].filter((model): model is ModelDef => model !== undefined);
}

/** A working model that has this skill, if any. */
export function modelWith(state: GameState, content: Content, skill: ModelSkill): ModelDef | undefined {
  return workingModels(state, content).find((model) => model.skills.includes(skill));
}

export function hasSkill(state: GameState, content: Content, skill: ModelSkill): boolean {
  return modelWith(state, content, skill) !== undefined;
}

/**
 * Rents a model for one period from the board the player is logged in
 * to. Renting the same one again adds a period; a different one starts
 * now and replaces it. Returns a reason if it can't be done.
 */
export function rentModel(state: GameState, content: Content, connectionId: string, modelId: string): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null || findServer(content, connection.serverId)?.kind !== 'board') {
    return 'Log in to the board first.';
  }
  const model = findModel(content, modelId);
  if (!model) return 'That is not for rent.';
  const shop = shopOf(findServer(content, connection.serverId)!);
  if (!shop.models) return 'This shop does not rent models.';
  const price = shopPrice(shop, model.price);
  if (state.player.balance < price) return 'You cannot afford that.';
  const periodMs = content.rules.modelRentHours * 3_600_000;
  const current = rentedModel(state, content);
  const from = current?.id === model.id ? state.player.model!.untilMs : state.clock.gameTimeMs;
  state.player.balance -= price;
  state.player.model = { id: model.id, untilMs: from + periodMs };
  return null;
}

/** Has the model read every file the connection can open. Returns a reason if it can't. */
export function modelRead(state: GameState, content: Content, connectionId: string): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null) return 'Log in first.';
  if (!hasSkill(state, content, 'read')) return 'You have no model that can do that.';
  readEverything(state, content, connection.serverId);
  return null;
}

/** Ends a rental that has run out, and says so. */
export function endRental(state: GameState, content: Content): void {
  const rental = state.player.model;
  if (!rental || rental.untilMs > state.clock.gameTimeMs) return;
  state.player.model = null;
  sendMail(state, content, 'modelExpired', { model: findModel(content, rental.id)?.name ?? 'Your model' });
}

/** True if a watching model should cut this connection now: its trace is about to finish. */
export function shouldPullOut(state: GameState, content: Content, connection: Connection): boolean {
  if (connection.trace.status !== 'active' || traceHeld(state, content, connection)) return false;
  if (!hasSkill(state, content, 'watch')) return false;
  return traceReport(connection.trace).remainingMs <= content.rules.modelWatchSeconds * 1000;
}
