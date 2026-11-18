/**
 * Parts for the player's gateway. Written in hardware.json; checked here
 * when the game starts. Each slot has tiers; tier 1 of the core slots is
 * what every gateway starts with. The model rack starts empty (tier 0).
 */
import { ContentError } from './schema';

export const HARDWARE_SLOTS = ['cpu', 'storage', 'modem', 'ports', 'rack'] as const;
/**
 * - cpu: how fast programs run, and how many run at once.
 * - storage: room on the gateway, in GB.
 * - modem: how fast files copy and delete.
 * - ports: how many connections can be open at once.
 * - rack: hosts a language model on the gateway, so there is no rent to pay.
 */
export type HardwareSlot = (typeof HARDWARE_SLOTS)[number];

export interface HardwareDef {
  readonly id: string;
  readonly slot: HardwareSlot;
  /** 1 = the part a new gateway has (rack: 1 = the first one you can buy). */
  readonly tier: number;
  readonly name: string;
  readonly blurb: string;
  /** Credits. 0 for the parts a new gateway comes with. */
  readonly price: number;
  /** cpu: programs run this many times faster. */
  readonly speed?: number;
  /** cpu: programs that can run at once. */
  readonly programs?: number;
  /** storage: room on the gateway, in GB. */
  readonly storageGb?: number;
  /** modem: files copy and delete this many times faster. */
  readonly fileSpeed?: number;
  /** ports: connections open at once. */
  readonly connections?: number;
  /** rack: id of the model it hosts (from models.json). */
  readonly model?: string;
  /** rack: room the model's weights take on the gateway, in GB. */
  readonly sizeGb?: number;
}

/** The value each slot must give, and its allowed range. */
const NEEDS: Record<HardwareSlot, readonly (readonly [keyof HardwareDef, number, number])[]> = {
  cpu: [
    ['speed', 1, 20],
    ['programs', 1, 20],
  ],
  storage: [['storageGb', 1, 100_000]],
  modem: [['fileSpeed', 1, 20]],
  ports: [['connections', 1, 10]],
  rack: [['sizeGb', 0, 1000]],
};

export function parseHardware(data: unknown, modelIds: readonly string[], file = 'hardware.json'): HardwareDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of parts');
  const parts = data.map((raw: unknown, index): HardwareDef => {
    if (typeof raw !== 'object' || raw === null) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const id = text('id');
    const where = `part "${id}"`;
    const number = (key: string, min: number, max: number): number => {
      const value = item[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new ContentError(file, `${where} needs a number "${key}" between ${min} and ${max}`);
      }
      return value;
    };
    const slot = text('slot');
    if (!(HARDWARE_SLOTS as readonly string[]).includes(slot)) {
      throw new ContentError(file, `${where}: slot "${slot}" is not one of ${HARDWARE_SLOTS.join(', ')}`);
    }
    const tier = number('tier', 1, 10);
    if (!Number.isInteger(tier)) throw new ContentError(file, `${where}: tier must be a whole number`);
    const part: Record<string, unknown> = {
      id,
      slot,
      tier,
      name: text('name'),
      blurb: text('blurb'),
      price: number('price', 0, 10_000_000),
    };
    for (const [key, min, max] of NEEDS[slot as HardwareSlot]) part[key] = number(key, min, max);
    if (slot === 'rack') {
      const model = text('model');
      if (!modelIds.includes(model)) throw new ContentError(file, `${where}: model "${model}" is not in models.json`);
      part.model = model;
    }
    return part as unknown as HardwareDef;
  });

  const ids = parts.map((part) => part.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated) throw new ContentError(file, `part id "${repeated}" is used twice`);
  for (const slot of HARDWARE_SLOTS) {
    const tiers = parts.filter((part) => part.slot === slot).map((part) => part.tier).sort((a, b) => a - b);
    if (slot !== 'rack' && tiers[0] !== 1) throw new ContentError(file, `slot "${slot}" needs a tier 1 part`);
    if (tiers.some((tier, index) => tier !== index + 1)) throw new ContentError(file, `slot "${slot}": tiers must run 1, 2, 3 with no gaps or repeats`);
    if (slot !== 'rack' && parts.some((part) => part.slot === slot && part.tier === 1 && part.price !== 0)) {
      throw new ContentError(file, `slot "${slot}": the tier 1 part is what every gateway has, so its price must be 0`);
    }
  }
  return parts;
}
