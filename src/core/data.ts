/**
 * The data market at Lowtide: stolen files, sold for what they are worth
 * today.
 *
 * Every file has a kind (keys, research, ledgers, records, mail, or odds
 * and ends: see data.json), read from its name. Its price is the kind's
 * base, raised for a better-guarded company and a bigger file, times the
 * day's swing for that kind (seeded by day, so the board is the same for
 * everyone looking on the same day), and lowered the longer the player
 * has held it, if the victim has been in the paper since it was taken, or
 * if it is still encrypted.
 *
 * The file a client is waiting for can be sold here too. Lowtide pays
 * twice what the client would, but the job is lost and whoever was
 * behind it remembers.
 */
import type { DataKindDef } from '../content/data';
import { activeContract } from './contracts';
import { burnHeist } from './heists';
import { editionDay, inTheNews } from './news';
import { isShut } from './market';
import { noteFailure, shiftStanding } from './patrons';
import { createRng, hashSeed } from './rng';
import { stagesOf } from './stages';
import { CLIENT_FILE, type GameState, type StoredFile } from './state';
import { fileDef, findConnection, findServer, type Content } from './world';

/** The board that buys data. */
export const DATA_BOARD = 'lowtide-exchange';
/** Days a file takes to lose half its value. */
export const HALF_LIFE_DAYS = 4;
/** A file never falls below this share of its fresh value. */
export const DECAY_FLOOR = 0.25;
/** Share paid once the victim has been in the paper since the file was taken. */
export const NEWS_CUT = 0.5;
/** Share paid for a file still encrypted. */
export const ENCRYPTED_CUT = 0.5;
/** A day's swing in a kind's price. */
export const SWING = [0.6, 1.5] as const;
/** Lowtide pays this times a client's fee for the file the client is waiting for. */
export const CLIENT_PREMIUM = 2;
/** Standing lost with the patron behind a job whose file was sold. */
export const BETRAYAL_STANDING = 4;

const DAY_MS = 24 * 3_600_000;

/** The kind of a file, from words in its name. */
export function dataKind(content: Content, name: string): DataKindDef | undefined {
  const market = content.data;
  if (!market) return undefined;
  const lower = name.toLowerCase();
  return market.kinds.find((kind) => kind.words.some((word) => lower.includes(word))) ?? market.other;
}

/** How a kind's price stands on a given edition day, as a multiple of its base. */
export function daySwing(state: GameState, kindId: string, day: number): number {
  const rng = createRng(hashSeed(`${state.seed}:data:${day}:${kindId}`));
  return Math.round(rng.range(SWING[0], SWING[1]) * 100) / 100;
}

/** Today's swing for each kind, beside yesterday's. */
export function priceBoard(state: GameState, content: Content): { kind: DataKindDef; today: number; yesterday: number }[] {
  const market = content.data;
  if (!market) return [];
  const day = editionDay(state.clock.gameTimeMs);
  return [...market.kinds, market.other].map((kind) => ({ kind, today: daySwing(state, kind.id, day), yesterday: daySwing(state, kind.id, day - 1) }));
}

/** How hard a company is to get into, 1 to 5: its tier, or for a written server its security. */
function tierOf(content: Content, serverId: string): number {
  const server = findServer(content, serverId);
  if (!server) return 1;
  if (server.generated) return server.generated.tier;
  const { password, proxy, firewall, monitor } = server.security;
  return Math.max(1, Math.min(5, Math.ceil((password + proxy + firewall + monitor) / 3)));
}

/** The active contract's file, if this is it and the contract can be sold out from under. */
function clientWaiting(state: GameState, content: Content, file: StoredFile) {
  const contract = activeContract(state, content);
  if (!contract) return undefined;
  const wants = stagesOf(contract).some((stage) => stage.objective.kind === 'steal' && stage.objective.file === file.name && stage.targetId === file.from);
  return wants ? contract : undefined;
}

export interface Quote {
  readonly kind: DataKindDef;
  readonly price: number;
  /** Whole days since it was taken. */
  readonly heldDays: number;
  /** True if the victim has been in the paper since. */
  readonly inNews: boolean;
  /** The contract waiting on this file, if selling it would betray a client. */
  readonly betrays?: { readonly id: string; readonly title: string; readonly client: string };
}

/** What Lowtide would pay for a file on the gateway right now, or why it will not buy it. */
export function quote(state: GameState, content: Content, file: StoredFile): Quote | string {
  if (!content.data) return 'Nobody here buys data.';
  if (file.from === CLIENT_FILE || file.doctored) return 'Lowtide does not buy what a client sent you.';
  const written = fileDef(content, file.from, file.name);
  if (written?.part || written?.program) return 'That is gear, not data. Take it to the Workbench.';
  if (state.data.sold.includes(soldKey(file))) return 'Lowtide already has a copy of that.';
  const waiting = clientWaiting(state, content, file);
  if (waiting?.story) return 'Not that one. Too many people are looking for it.';
  const kind = dataKind(content, file.name)!;
  const now = state.clock.gameTimeMs;
  const takenMs = file.takenMs ?? now;
  const heldDays = Math.max(0, Math.floor((now - takenMs) / DAY_MS));
  const decay = Math.max(DECAY_FLOOR, 0.5 ** ((now - takenMs) / DAY_MS / HALF_LIFE_DAYS));
  // An edition since the file was taken that names the victim cuts the price.
  const inNews = inTheNews(state, file.from, takenMs);
  const tier = tierOf(content, file.from);
  const size = 1 + Math.min(file.sizeGq, 40) / 20;
  const swing = daySwing(state, kind.id, editionDay(now));
  let price = kind.base * (0.6 + 0.4 * tier) * size * swing * decay * (inNews ? NEWS_CUT : 1) * (file.encrypted ? ENCRYPTED_CUT : 1);
  if (waiting) price = Math.max(price, waiting.pay * CLIENT_PREMIUM);
  return {
    kind,
    price: Math.max(10, Math.round(price / 10) * 10),
    heldDays,
    inNews,
    ...(waiting ? { betrays: { id: waiting.id, title: waiting.title, client: waiting.client } } : {}),
  };
}

const soldKey = (file: { from: string; name: string }) => `${file.from}:${file.name}`;

/** Sells a file from the gateway at Lowtide. Null on success, or the reason it was refused. */
export function sellData(state: GameState, content: Content, connectionId: string, name: string, from: string): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null || connection.serverId !== DATA_BOARD) return 'Log in at Lowtide to sell data.';
  if (isShut(state, DATA_BOARD)) return 'Lowtide is shut. Nobody there is buying until it reopens.';
  const file = state.player.files.find((item) => item.name === name && item.from === from);
  if (!file) return 'That file is not on your gateway.';
  const offer = quote(state, content, file);
  if (typeof offer === 'string') return offer;
  state.player.files = state.player.files.filter((item) => item !== file);
  state.player.balance += offer.price;
  state.data.sold.push(soldKey(file));
  if (offer.betrays) betray(state, content);
  return null;
}

/** The client's file went to Lowtide: the job is lost, and the patron behind it remembers. */
function betray(state: GameState, content: Content): void {
  const contract = activeContract(state, content);
  if (!contract) return;
  if (burnHeist(state, content, contract)) return;
  noteFailure(state, content, contract, true);
  if (contract.patron) shiftStanding(state, content, contract.patron, -BETRAYAL_STANDING);
  state.contracts.activeId = null;
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
  state.contracts.heldMs = 0;
  state.contracts.guard = null;
  state.contracts.raceUntilMs = 0;
  state.player.files = state.player.files.filter((file) => file.from !== CLIENT_FILE);
  state.messages.push({
    id: `m${state.nextId++}`,
    from: contract.client,
    subject: `Re: ${contract.title}`,
    body: 'We hear our file is for sale at Lowtide, and that you were the one selling it.\n\nThe job is off. We will remember this.',
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}
