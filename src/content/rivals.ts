/**
 * Enemy hackers who break into the player's gateway (see core/raid.ts).
 * Written in rivals.json; checked here when the game starts.
 *
 * Each rival has a home server the player learns on a win, a bounce chain
 * the counter-trace follows back, and a style that decides what a loss
 * costs. Never any lost hardware and never the end of a career.
 */
import { ContentError, type ServerDef } from './schema';

export const RIVAL_STYLES = ['thief', 'vandal', 'framer'] as const;
/**
 * What a rival does if they beat you.
 * - thief: takes credits.
 * - vandal: wipes one of your files or programs (one that is not locked).
 * - framer: plants evidence that brings a log review on you.
 */
export type RivalStyle = (typeof RIVAL_STYLES)[number];

export interface RivalDef {
  readonly id: string;
  /** The handle the player sees, e.g. "Mirrorjack". */
  readonly handle: string;
  /** One line on how they work. */
  readonly blurb: string;
  /** Id of their home server, which the player learns the address of on a win. */
  readonly homeId: string;
  /** Relay ids from their home toward the player's gateway: the chain the counter-trace follows back. */
  readonly relays: readonly string[];
  /** 1 to 5: how hard they hit. Higher breaks in faster and sets up more barriers. */
  readonly level: number;
  /** Lowest player rating at which this rival turns up in a random attack. */
  readonly minRating: number;
  readonly style: RivalStyle;
  /** The line they leave behind when the attack ends. */
  readonly taunt: string;
  /** True for one only the story sends (such as Warden in the final job): never in a random attack. */
  readonly storyOnly?: boolean;
}

export function parseRivals(data: unknown, file = 'rivals.json'): RivalDef[] {
  if (!Array.isArray(data)) throw new ContentError(file, 'must be a list of rivals');
  const seen = new Set<string>();
  return data.map((raw: unknown, index): RivalDef => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ContentError(file, `entry ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const value = item[key];
      if (typeof value !== 'string' || value.trim() === '') throw new ContentError(file, `entry ${index} needs a non-empty text "${key}"`);
      return value;
    };
    const whole = (key: string, min: number, max: number): number => {
      const value = item[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new ContentError(file, `entry ${index} needs a whole number "${key}" from ${min} to ${max}`);
      }
      return value;
    };
    const id = text('id');
    const where = `rival "${id}"`;
    if (seen.has(id)) throw new ContentError(file, `rival id "${id}" is used twice`);
    seen.add(id);
    const style = item['style'];
    if (!(RIVAL_STYLES as readonly unknown[]).includes(style)) {
      throw new ContentError(file, `${where}: style must be one of ${RIVAL_STYLES.join(', ')}`);
    }
    const relays = item['relays'];
    if (!Array.isArray(relays) || !relays.every((entry) => typeof entry === 'string' && entry !== '')) {
      throw new ContentError(file, `${where}: relays must be a list of server ids`);
    }
    return {
      id,
      handle: text('handle'),
      blurb: text('blurb'),
      homeId: text('homeId'),
      relays: relays as string[],
      level: whole('level', 1, 5),
      minRating: whole('minRating', 0, 100000),
      style: style as RivalStyle,
      taunt: text('taunt'),
      ...(item['storyOnly'] === true ? { storyOnly: true } : {}),
    };
  });
}

/** Checks the rivals agree with the servers. */
export function checkRivals(rivals: readonly RivalDef[], servers: readonly ServerDef[]): void {
  const byId = new Map(servers.map((server) => [server.id, server]));
  for (const rival of rivals) {
    const where = `rival "${rival.id}"`;
    const home = byId.get(rival.homeId);
    if (!home) throw new ContentError('rivals.json', `${where}: home "${rival.homeId}" is not a server`);
    if (home.kind === 'gateway') throw new ContentError('rivals.json', `${where}: home must not be the gateway`);
    for (const id of rival.relays) {
      const relay = byId.get(id);
      if (!relay) throw new ContentError('rivals.json', `${where}: relay "${id}" is not a server`);
      if (relay.kind === 'gateway') throw new ContentError('rivals.json', `${where}: a relay must not be the gateway`);
      if (id === rival.homeId) throw new ContentError('rivals.json', `${where}: the home cannot also be a relay`);
    }
  }
}
