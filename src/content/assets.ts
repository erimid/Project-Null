/**
 * Property: the big things a long career buys once the gateway itself is
 * built. Written in assets.json; checked here when the game starts. What
 * each one does is a rule in the core (see core/assets.ts), named here by
 * its `effect`.
 */
import { ContentError } from './schema';

export const ASSET_EFFECTS = ['relay', 'safeHouse', 'secondGateway', 'spareHands', 'nightDesk', 'cutOut'] as const;
/**
 * - relay: a relay server of the player's own (`serverId`), which never warms up.
 * - safeHouse: half the time lying low, heat fades twice as fast, a trace burns no hardware.
 * - secondGateway: one more connection, two more programs at once, 16 GB more memory.
 * - spareHands: the hands-on shortcuts of a password, a proxy and a decrypter play themselves.
 * - nightDesk: the player's lines are scrubbed when they leave a server, so no review finds them.
 * - cutOut: once a game day, a trace that gets home costs nothing but the connection.
 */
export type AssetEffect = (typeof ASSET_EFFECTS)[number];

export interface AssetDef {
  readonly id: string;
  readonly name: string;
  /** The city it is in, for the shelf. */
  readonly where: string;
  readonly blurb: string;
  readonly price: number;
  /** The rating the broker wants before selling it. */
  readonly minRating: number;
  readonly effect: AssetEffect;
  /** For a relay: the server that goes into the address book. */
  readonly serverId?: string;
}

export function parseAssets(data: unknown, serverIds: readonly string[], file = 'assets.json'): AssetDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list');
  const seen = new Set<string>();
  return data.map((raw: unknown, index): AssetDef => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const whole = (key: string): number => {
      const value = item[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new ContentError(file, `entry ${index} needs a whole number "${key}" of 0 or more`);
      return value;
    };
    const id = text('id');
    if (seen.has(id)) throw new ContentError(file, `asset id "${id}" is used twice`);
    seen.add(id);
    const effect = item['effect'];
    if (!(ASSET_EFFECTS as readonly unknown[]).includes(effect)) throw new ContentError(file, `asset "${id}": effect must be one of ${ASSET_EFFECTS.join(', ')}`);
    const price = whole('price');
    if (price <= 0) throw new ContentError(file, `asset "${id}" needs a price above 0`);
    const serverId = item['serverId'];
    if (effect === 'relay') {
      if (typeof serverId !== 'string' || !serverIds.includes(serverId)) throw new ContentError(file, `asset "${id}": serverId must name a server`);
    } else if (serverId !== undefined) throw new ContentError(file, `asset "${id}": only a relay has a serverId`);
    return {
      id,
      name: text('name'),
      where: text('where'),
      blurb: text('blurb'),
      price,
      minRating: whole('minRating'),
      effect: effect as AssetEffect,
      ...(typeof serverId === 'string' ? { serverId } : {}),
    };
  });
}
