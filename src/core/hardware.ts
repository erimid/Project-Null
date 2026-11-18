/**
 * The player's gateway hardware: what is installed decides how fast
 * programs run, how many run at once, how much fits on the gateway, how
 * fast files move, how many connections can be open, and whether a model
 * runs at home.
 */
import type { HardwareDef, HardwareSlot } from '../content/hardware';
import type { ModelDef } from '../content/models';
import type { GameState, HardwareState } from './state';
import { stream } from './streams';
import { findConnection, findServer, sendMail, type Content } from './world';

/** Slots in the order screens list them, with their names. */
export const HARDWARE_SLOT_LABELS: readonly (readonly [HardwareSlot, string])[] = [
  ['cpu', 'Processor'],
  ['storage', 'Storage'],
  ['modem', 'Modem'],
  ['ports', 'Connection ports'],
  ['rack', 'Model rack'],
];

/** What a new gateway has: tier 1 of everything, and an empty model rack. */
export const STOCK_HARDWARE: HardwareState = { cpu: 1, storage: 1, modem: 1, ports: 1, rack: 0 };

export function findPart(content: Content, slot: HardwareSlot, tier: number): HardwareDef | undefined {
  return content.hardware.find((part) => part.slot === slot && part.tier === tier);
}

/** The part installed in a slot. Undefined for an empty rack. */
export function installed(state: GameState, content: Content, slot: HardwareSlot): HardwareDef | undefined {
  return findPart(content, slot, state.player.hardware[slot]);
}

/** Programs run this many times faster than on a stock gateway. */
export const cpuSpeed = (state: GameState, content: Content): number => installed(state, content, 'cpu')?.speed ?? 1;
/** Files copy and delete this many times faster than on a stock gateway. */
export const fileSpeed = (state: GameState, content: Content): number => installed(state, content, 'modem')?.fileSpeed ?? 1;
export const maxPrograms = (state: GameState, content: Content): number => installed(state, content, 'cpu')?.programs ?? 3;
export const storageGb = (state: GameState, content: Content): number => installed(state, content, 'storage')?.storageGb ?? 40;
export const maxConnections = (state: GameState, content: Content): number =>
  installed(state, content, 'ports')?.connections ?? 1;

/** The model running on the gateway's own rack, if one is installed. */
export function hostedModel(state: GameState, content: Content): ModelDef | undefined {
  const id = installed(state, content, 'rack')?.model;
  return id === undefined ? undefined : content.models.find((model) => model.id === id);
}

/** Room the hosted model's weights take on the gateway. */
export const rackStorageGb = (state: GameState, content: Content): number => installed(state, content, 'rack')?.sizeGb ?? 0;

/**
 * Buys a part from the board the player is logged in to and installs it
 * straight away, replacing whatever was in that slot. Only upgrades: a
 * part at or below the installed tier is refused. Returns a reason if it
 * can't be done.
 */
export function buyHardware(state: GameState, content: Content, connectionId: string, partId: string, usedGb: number): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null || findServer(content, connection.serverId)?.kind !== 'board') {
    return 'Log in to the board first.';
  }
  const part = content.hardware.find((item) => item.id === partId);
  if (!part || part.price <= 0) return 'That is not for sale.';
  if (state.player.hardware[part.slot] >= part.tier) return 'Your gateway already has that or better.';
  if (state.player.balance < part.price) return 'You cannot afford that.';
  if (part.slot === 'rack') {
    const extra = (part.sizeGb ?? 0) - rackStorageGb(state, content);
    if (usedGb + extra > storageGb(state, content)) return 'Not enough room on your gateway for the model.';
  }
  state.player.balance -= part.price;
  state.player.hardware[part.slot] = part.tier;
  return null;
}

/**
 * Being traced by a server with strong security costs a part: one slot,
 * picked at random from those above stock, drops one tier. Returns the
 * part that was lost, if any.
 */
export function loseHardware(state: GameState, content: Content, serverId: string): HardwareDef | undefined {
  const server = findServer(content, serverId);
  if (!server) return undefined;
  const strongest = Math.max(server.security.password, server.security.proxy, server.security.firewall, server.security.monitor);
  if (strongest < content.rules.hardwareLossLevel) return undefined;
  const slots = (Object.keys(state.player.hardware) as HardwareSlot[]).filter(
    (slot) => state.player.hardware[slot] > STOCK_HARDWARE[slot],
  );
  if (slots.length === 0) return undefined;
  const slot = slots[stream(state, 'hardware').int(0, slots.length - 1)]!;
  const lost = installed(state, content, slot);
  state.player.hardware[slot]--;
  if (lost) {
    const now = installed(state, content, slot);
    sendMail(state, content, 'hardwareLost', { part: lost.name, now: now?.name ?? 'nothing' });
  }
  return lost;
}
