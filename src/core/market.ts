/**
 * Shops. A board server can carry its own shelf (see ShopDef): some
 * categories of gear, at its own prices, plus rare lines that come and go
 * by the day. A board with no shop of its own is a general store that
 * sells everything at list price.
 *
 * Staples are always in stock. Rare lines are shown by a daily roll that
 * depends only on the shop, the day and the line, so the shelf is the same
 * for everyone on a given day and changes at midnight game time.
 */
import type { ProgramDef, RareStockDef, ServerDef, ShopDef } from '../content/schema';
import type { HardwareDef } from '../content/hardware';
import type { ModuleDef } from '../content/modules';
import type { GameState } from './state';
import type { Content } from './world';
import { shopDiscount } from './patrons';
import { wanted } from './wanted';
import { createRng, hashSeed } from './rng';

/** A board with no shop of its own sells everything at list price. */
export const GENERAL_STORE: ShopDef = { programs: true, hardware: true, modules: true, models: true, priceFactor: 1 };

/** What a board server sells. */
export const shopOf = (server: ServerDef): ShopDef => server.shop ?? GENERAL_STORE;

/** What a shop sells and its prices for this player: a patron who trusts them may have arranged a discount (see patrons.ts). */
export function shopFor(state: GameState, content: Content, server: ServerDef): ShopDef {
  const shop = shopOf(server);
  const off = shopDiscount(state, content, server.id);
  // Someone who is wanted pays for the risk of being sold to.
  const risk = wanted(state).prices;
  // While a crackdown has one market shut, the others charge more (see events.ts).
  const scarce = shutMarket(state) !== undefined ? CRACKDOWN_PRICES : 1;
  return off > 0 || risk !== 1 || scarce !== 1 ? { ...shop, priceFactor: shop.priceFactor * (1 - off) * risk * scarce } : shop;
}

/** While one market is shut, the others charge this many times their price. */
export const CRACKDOWN_PRICES = 1.15;

/** The market a crackdown has shut, if one is on (see events.ts). */
export function shutMarket(state: GameState): string | undefined {
  const event = state.events?.current;
  return event?.kind === 'crackdown' ? event.serverId : undefined;
}

/** True while this shop is shut by a crackdown: it sells nothing. */
export const isShut = (state: GameState, serverId: string): boolean => shutMarket(state) === serverId;

/** Which day it is, counting from the start of game time. Rare stock turns over at each day's end. */
export const marketDay = (state: GameState): number => Math.floor(state.clock.gameTimeMs / 86_400_000);

/** A list a rare roll keys on, so the same shop shows the same shelf all day. */
const rareKey = (line: RareStockDef): string => `${line.kind}:${line.id}:${line.grade ?? 0}`;

/** True if this rare line is on a shop's shelf today. Pure: depends only on the shop, the day and the line. */
export function rareShown(serverId: string, day: number, line: RareStockDef): boolean {
  return createRng(hashSeed(`shop:${serverId}:${day}:${rareKey(line)}`)).chance(line.chance);
}

/** The rare lines of a shop that are on its shelf today. */
export function rareToday(state: GameState, server: ServerDef): RareStockDef[] {
  const day = marketDay(state);
  if (isShut(state, server.id)) return [];
  return (shopOf(server).rare ?? []).filter((line) => rareShown(server.id, day, line));
}

/** The price a shop asks for something, rounded. */
export const shopPrice = (shop: ShopDef, base: number): number => Math.round(base * shop.priceFactor);

/** True if a shop sells this program today: a staple it carries, or a rare line shown today. */
export function sellsProgram(state: GameState, server: ServerDef, program: ProgramDef): boolean {
  if (isShut(state, server.id)) return false;
  const shop = shopOf(server);
  if (shop.programs && (!shop.programKinds || shop.programKinds.includes(program.kind)) && program.version <= (shop.maxVersion ?? Infinity) && !shop.excludePrograms?.includes(program.id)) return true;
  return rareToday(state, server).some((line) => line.kind === 'program' && line.id === program.id);
}

/** True if a shop sells this hardware part today. */
export function sellsHardware(state: GameState, server: ServerDef, part: HardwareDef): boolean {
  if (isShut(state, server.id)) return false;
  const shop = shopOf(server);
  if (shop.hardware && part.tier <= (shop.maxTier ?? Infinity) && (!shop.hardwareSlots || shop.hardwareSlots.includes(part.slot))) return true;
  return rareToday(state, server).some((line) => line.kind === 'hardware' && line.id === part.id);
}

/** True if a shop sells this module at this grade today. */
export function sellsModule(state: GameState, server: ServerDef, module: ModuleDef, grade: number): boolean {
  if (isShut(state, server.id)) return false;
  if (shopOf(server).modules && grade <= (shopOf(server).maxGrade ?? Infinity)) return true;
  return rareToday(state, server).some((line) => line.kind === 'module' && line.id === module.id && (line.grade ?? grade) === grade);
}

/** True if this server is a shop only: it sells, and posts no contracts. */
export const sellsOnly = (server: ServerDef): boolean => server.shop?.contracts === false;
