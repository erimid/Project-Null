/**
 * Things that happen on the darknet. One at a time, every two or three
 * game days once the player's rating is high enough. Each arrives as a
 * message, shows as a page on one of the darknet sites, and may put a
 * job on the board.
 *
 * - auction: Lowtide puts one rare module or part up for a day. Named
 *   runners bid, each up to a limit of their own. The player can bid, and
 *   is answered if anyone has room to; or buy it outright for more.
 * - bounty: Glasshouse wants one file and has told several runners. Each
 *   is some way along; when the first of them finishes, the job is gone.
 * - dump: a company's staff logins leak. The player holds them for a few
 *   hours, and the company watches harder until it resets them.
 * - crackdown: one market is shut for two days and the others charge
 *   more. The list of what was seized is worth money to someone.
 * - runner: a rival from the ladder left a trail and asks for help. Help,
 *   and they owe a favour: they stand down from one race against the
 *   player, or warn of one raid, whichever comes first.
 * - offer: a private offer of well-paid work. Half of them are a trap,
 *   and a trap has tells: a new account, pay that makes no sense, a client
 *   who has the company's trade wrong. Report a trap and Halyard pays for
 *   the warning. Take it and the trace starts on connecting.
 *
 * Every draw is on the 'events' stream, so nothing else moves.
 *
 * Wording (content/events.json) is filled with: {company} {city} {file}
 * {pay} {runners} {hours} {days} {percent} {shop} {who} {client} {account}
 * {trade} {goal} {lot} {price} {buy} {n}, as each kind has them.
 */
import { EVENT_KINDS, type EventKind, type EventsDef } from '../content/events';
import type { ServerDef, TwistDef } from '../content/schema';
import type { BlockDef } from '../content/sites';
import { addParts, marketGrade } from './crafting';
import { fill } from './generate';
import { plainJob, tierForRating, touchedServers } from './jobs';
import { CRACKDOWN_PRICES } from './market';
import { markServer } from './news';
import { shiftStanding } from './patrons';
import type { Rng } from './rng';
import type { Connection, DarkEvent, EventLot, GameState, Job } from './state';
import { stream } from './streams';
import { findServer, sendLetter, type Content } from './world';

/** The rating from which things start to happen. */
export const EVENTS_RATING = 20;
/** Game hours from one event starting to the next, least and most. */
export const EVENT_GAP_HOURS = [48, 72] as const;
/** Game hours each kind lasts. A bounty lasts until the first runner finishes. */
export const EVENT_HOURS: Readonly<Record<EventKind, number>> = { auction: 24, bounty: 20, dump: 12, crackdown: 48, runner: 24, offer: 18 };
/** What an event's job pays, as a share of an ordinary job against the same company. */
export const EVENT_PAY = { bounty: 1.6, dump: 1.2, crackdown: 1.4, runner: 0.6, offer: 1.5, sting: 3 } as const;
/** An auction opens at this share of the list price, and the lot can be bought outright for this share. */
export const AUCTION_OPEN = 0.5;
export const AUCTION_BUY = 1.25;
/** The most a runner will bid, as a share of the list price: least and most. */
export const AUCTION_CAPS = [0.6, 1.1] as const;
/** Share of private offers that are a trap. */
export const STING_SHARE = 0.5;
/** A trap's trace runs in this share of the usual time. */
export const STING_TRACE = 0.5;
/** Halyard pays this share of an ordinary job's pay for a warning that was right. */
export const WARNING_PAY = 0.5;
/** The highest bidder's name when it is the player. */
export const YOU = '@you';

const HOUR = 3_600_000;
const fifty = (credits: number) => Math.round(credits / 50) * 50;
type Values = Record<string, string>;

const racers = (content: Content): readonly string[] => content.companies.jobs.racers ?? [];
const hoursLeft = (state: GameState, event: DarkEvent) => Math.max(1, Math.ceil((event.untilMs - state.clock.gameTimeMs) / HOUR));

/** A ladder rival's handle, by id. */
const handleOf = (content: Content, id: string): string => content.ladder?.rivals.find((rival) => rival.id === id)?.handle ?? id;

/** The job an event carries, while it is on the board. */
export function eventJob(state: GameState, event: DarkEvent | null = state.events.current): Job | undefined {
  return event?.jobId === undefined ? undefined : state.contracts.jobs.find((job) => job.id === event.jobId);
}

/** What the lot in an auction costs to buy outright. */
export const buyNowPrice = (lot: EventLot): number => fifty(lot.list * AUCTION_BUY);

/** What the next bid on an auction would be. */
export function nextBid(event: DarkEvent): number {
  const step = Math.max(50, fifty((event.lot?.list ?? 0) * 0.05));
  return event.top === '' ? (event.price ?? 0) : (event.price ?? 0) + step;
}

/** Generated companies the board could send the player to now, and that no job on it touches. */
function companies(state: GameState, content: Content, fits: (server: ServerDef) => boolean = () => true): ServerDef[] {
  const tier = tierForRating(state.player.rating, content.rules.tierRatings);
  const busy = touchedServers(state);
  return content.servers.filter((server) => server.generated && server.generated.tier <= tier && server.generated.tier >= tier - 1 && !busy.has(server.id) && fits(server));
}

const usualPay = (content: Content, server: ServerDef): number => content.rules.jobPay[(server.generated?.tier ?? 1) - 1] ?? 0;

/** Different runners' handles. */
function runnersFor(content: Content, rng: Rng, count: number): string[] {
  return rng.shuffle([...racers(content)]).slice(0, count);
}

/** Posts an event's job: on top of the board's usual number, like a job the news opened. */
function post(state: GameState, job: Job, line: string, untilMs: number): string {
  state.contracts.jobs.push({ ...job, expiresMs: untilMs, news: line, dark: true });
  return job.id;
}

type Words = EventsDef[EventKind];
const worded = (job: Job, words: Words, values: Values, rng: Rng): Job => {
  const card = words.job!;
  return {
    ...job,
    title: fill(rng.pick(card.titles), values),
    summary: fill(rng.pick(card.summaries), values),
    brief: fill(rng.pick(card.briefs), values),
    ...(card.clients ? { client: fill(rng.pick(card.clients), values) } : {}),
  };
};

type Make = (state: GameState, content: Content, words: Words, rng: Rng, base: Pick<DarkEvent, 'id' | 'startMs'>) => { event: DarkEvent; values: Values } | undefined;

const auction: Make = (state, content, _words, rng, base) => {
  const names = runnersFor(content, rng, 3);
  if (names.length < 2) return undefined;
  const grade = Math.min(3, marketGrade(state, content) + 1);
  const modules: EventLot[] = content.modules.flatMap((module) => {
    const price = module.grades[grade - 1]?.price;
    return price === undefined ? [] : [{ kind: 'module' as const, id: module.id, grade, name: `${module.name} ${grade}`, list: price }];
  });
  // A part a step or two better than the gateway has. Never a model rack: that needs room for its model.
  const parts: EventLot[] = content.hardware
    .filter((part) => part.price > 0 && part.slot !== 'rack' && part.tier > state.player.hardware[part.slot] && part.tier <= state.player.hardware[part.slot] + 2)
    .map((part) => ({ kind: 'hardware' as const, id: part.id, name: part.name, list: part.price }));
  const pool = parts.length > 0 && (modules.length === 0 || rng.chance(0.4)) ? parts : modules;
  if (pool.length === 0) return undefined;
  const lot = rng.pick(pool);
  const untilMs = base.startMs + EVENT_HOURS.auction * HOUR;
  const runners = names.map((who) => ({ who, cap: fifty(lot.list * rng.range(AUCTION_CAPS[0], AUCTION_CAPS[1])) }));
  const moments = Array.from({ length: rng.int(4, 7) }, () => ({ atMs: base.startMs + rng.range(1, EVENT_HOURS.auction - 1) * HOUR, who: rng.pick(names) })).sort((a, b) => a.atMs - b.atMs);
  const price = fifty(lot.list * AUCTION_OPEN);
  return {
    event: { ...base, kind: 'auction', untilMs, lot, price, top: '', runners, moments },
    values: { lot: lot.name, price: String(price), buy: String(buyNowPrice(lot)), hours: String(EVENT_HOURS.auction) },
  };
};

const bounty: Make = (state, content, words, rng, base) => {
  const names = runnersFor(content, rng, 3);
  const free = companies(state, content);
  if (names.length < 2 || free.length === 0) return undefined;
  const server = rng.pick(free);
  const plain = plainJob(state, content, server, rng, ['steal']);
  if (!plain) return undefined;
  let runners = names.map((who) => ({ who, fromMs: base.startMs, doneMs: base.startMs + rng.range(8, EVENT_HOURS.bounty) * HOUR }));
  // A runner who owes the player a favour pays it here: they pull out.
  const owing = runners.find((runner) => state.events.owed.some((id) => handleOf(content, id) === runner.who));
  if (owing) {
    runners = runners.filter((runner) => runner !== owing);
    state.events.owed = state.events.owed.filter((id) => handleOf(content, id) !== owing.who);
    sendLetter(state, words.letters['stoodDown']!, { who: owing.who });
  }
  const first = [...runners].sort((a, b) => a.doneMs - b.doneMs)[0]!;
  const pay = fifty(plain.job.pay * EVENT_PAY.bounty);
  const values = { ...plain.values, pay: String(pay), runners: runners.map((runner) => runner.who).join(', ') };
  const job: Job = { ...worded(plain.job, words, values, rng), pay, race: { rival: first.who, minutes: Math.round((first.doneMs - base.startMs) / 60_000), byMs: first.doneMs } };
  return { event: { ...base, kind: 'bounty', untilMs: first.doneMs, jobId: post(state, job, fill(words.title, values), first.doneMs), serverId: server.id, runners, pay }, values };
};

const dump: Make = (state, content, words, rng, base) => {
  const now = base.startMs;
  const open = companies(state, content, (server) => {
    const admin = server.accounts.find((account) => account.role === 'admin');
    const alert = state.servers[server.id]?.alert;
    return admin !== undefined && server.security.password > 0 && !(state.player.passwords[server.id]?.includes(admin.user) ?? false) && !(alert && alert.untilMs > now);
  });
  if (open.length === 0) return undefined;
  const server = rng.pick(open);
  const untilMs = now + EVENT_HOURS.dump * HOUR;
  const known = (state.player.passwords[server.id] ??= []);
  const granted = server.accounts.map((account) => account.user).filter((user) => !known.includes(user));
  known.push(...granted);
  // They know something is out: the network is watched harder until the reset.
  state.servers[server.id]!.alert = { raise: { monitor: 1 }, untilMs };
  markServer(state, server.id, 'Logins out', untilMs);
  if (!state.knownServers.includes(server.id)) state.knownServers.push(server.id);
  const values: Values = { company: server.name, city: server.city, hours: String(EVENT_HOURS.dump) };
  const plain = plainJob(state, content, server, rng);
  let jobId: string | undefined;
  if (plain) {
    const all = { ...plain.values, ...values, goal: plain.job.summary };
    jobId = post(state, { ...worded(plain.job, words, all, rng), pay: fifty(plain.job.pay * EVENT_PAY.dump) }, fill(words.title, values), untilMs);
  }
  return { event: { ...base, kind: 'dump', untilMs, serverId: server.id, granted, ...(jobId ? { jobId } : {}) }, values };
};

const crackdown: Make = (state, content, words, rng, base) => {
  const shops = content.servers.filter((server) => server.kind === 'board' && server.shop?.contracts === false);
  const known = shops.filter((server) => state.knownServers.includes(server.id));
  const free = companies(state, content);
  if (shops.length < 2 || free.length === 0) return undefined;
  const shop = rng.pick(known.length > 0 ? known : shops);
  const holder = rng.pick(free);
  const plain = plainJob(state, content, holder, rng);
  if (!plain) return undefined;
  const n = String(rng.int(100, 999));
  const file = fill(rng.pick(words.words['files']!), { n });
  if (state.servers[holder.id]?.files.some((item) => item.name === file) || state.player.files.some((own) => own.name === file)) return undefined;
  const untilMs = base.startMs + EVENT_HOURS.crackdown * HOUR;
  const values: Values = { shop: shop.name, company: holder.name, city: holder.city, file, n, days: String(EVENT_HOURS.crackdown / 24), percent: String(Math.round((CRACKDOWN_PRICES - 1) * 100)) };
  const twist: TwistDef = { kind: 'drop', file, sizeGq: 1, text: fill(rng.pick(words.words['texts']!), values), folder: 'held' };
  const job: Job = { ...worded(plain.job, words, values, rng), pay: fifty(plain.job.pay * EVENT_PAY.crackdown), objective: { kind: 'steal', file }, twists: [twist] };
  markServer(state, shop.id, 'Shut', untilMs);
  return { event: { ...base, kind: 'crackdown', untilMs, serverId: shop.id, holderId: holder.id, jobId: post(state, job, fill(words.title, values), untilMs) }, values };
};

const runner: Make = (state, content, words, rng, base) => {
  // One of the runners who only climb and talk. A raider would not ask.
  const able = (content.ladder?.rivals ?? []).filter((rival) => !rival.raider && !state.events.owed.includes(rival.id));
  const free = companies(state, content);
  if (able.length === 0 || free.length === 0 || !content.companies.jobs.side) return undefined;
  const rival = rng.pick(able);
  const server = rng.pick(free);
  const plain = plainJob(state, content, server, rng);
  if (!plain) return undefined;
  const untilMs = base.startMs + EVENT_HOURS.runner * HOUR;
  const values: Values = { ...plain.values, who: rival.handle };
  const job: Job = { ...worded(plain.job, words, values, rng), client: rival.handle, pay: fifty(plain.job.pay * EVENT_PAY.runner), objective: { kind: 'wipe', who: rival.handle } };
  return { event: { ...base, kind: 'runner', untilMs, rivalId: rival.id, serverId: server.id, jobId: post(state, job, fill(words.title, values), untilMs) }, values };
};

/** The trade each line of business is called, from the words "id=what it is called". */
function trades(words: Words): Record<string, string> {
  return Object.fromEntries((words.words['trades'] ?? []).map((line) => line.split('=') as [string, string]));
}

const offer: Make = (state, content, words, rng, base) => {
  const free = companies(state, content);
  if (free.length === 0) return undefined;
  const server = rng.pick(free);
  const plain = plainJob(state, content, server, rng);
  if (!plain) return undefined;
  const sting = rng.chance(STING_SHARE);
  // A trap gives itself away in two or three of these ways. An honest offer in none.
  const tells = sting ? rng.shuffle(['account', 'price', 'company']).slice(0, rng.int(2, 3)) : [];
  const called = trades(words);
  const sector = server.generated!.sector;
  const wrong = Object.keys(called).filter((id) => id !== sector);
  const trade = (tells.includes('company') && wrong.length > 0 ? called[rng.pick(wrong)] : called[sector]) ?? 'a company';
  const fresh = tells.includes('account');
  const account = fill(rng.pick(words.words[fresh ? 'newAccounts' : 'oldAccounts']!), { years: String(rng.int(2, 6)), jobs: String(rng.int(20, 90)) });
  const client = rng.pick(words.words[fresh ? 'newClients' : 'oldClients']!);
  const pay = fifty(plain.job.pay * (tells.includes('price') ? EVENT_PAY.sting : EVENT_PAY.offer));
  const untilMs = base.startMs + EVENT_HOURS.offer * HOUR;
  const values: Values = { ...plain.values, client, account, trade, pay: String(pay), goal: plain.job.summary };
  const job: Job = { ...worded(plain.job, words, values, rng), client, pay };
  return { event: { ...base, kind: 'offer', untilMs, serverId: server.id, sting, tells, account, trade, pay, jobId: post(state, job, fill(words.title, values), untilMs) }, values };
};

const MAKERS: Readonly<Record<EventKind, Make>> = { auction, bounty, dump, crackdown, runner, offer };

/** Hands the player what they bought at auction. */
function give(state: GameState, content: Content, lot: EventLot): void {
  if (lot.kind === 'module') return addParts(state, lot.id, lot.grade ?? 1);
  const part = content.hardware.find((item) => item.id === lot.id);
  if (part && state.player.hardware[part.slot] < part.tier) state.player.hardware[part.slot] = part.tier;
}

/** A runner looks at the lot again: they go one step over the highest bid if they have room to. */
function rivalBids(state: GameState, words: Words, event: DarkEvent, who: string, atMs: number): void {
  const cap = event.runners?.find((item) => item.who === who)?.cap ?? 0;
  const bid = nextBid(event);
  if (event.top === who || bid > cap) return;
  if (event.top === YOU) {
    state.player.balance += event.price ?? 0;
    sendLetter(state, words.letters['outbid']!, { who, price: String(bid), lot: event.lot!.name });
  }
  event.top = who;
  event.price = bid;
  // A bid in the last hour moves the close back, for everyone.
  if (event.untilMs - atMs < HOUR) event.untilMs = atMs + HOUR;
}

/** Ends whatever is happening, and leaves room before the next. */
function close(state: GameState): void {
  const now = state.clock.gameTimeMs;
  state.events.current = null;
  state.events.nextMs = Math.max(state.events.nextMs, now + 6 * HOUR);
}

/** Moves the event under way forward. True once it is over. */
function run(state: GameState, content: Content, def: EventsDef, event: DarkEvent): boolean {
  const now = state.clock.gameTimeMs;
  const words = def[event.kind];
  const over = now >= event.untilMs;
  switch (event.kind) {
    case 'auction': {
      const moments = event.moments ?? [];
      while (moments.length > 0 && moments[0]!.atMs <= Math.min(now, event.untilMs)) {
        const moment = moments.shift()!;
        rivalBids(state, words, event, moment.who, moment.atMs);
      }
      if (now < event.untilMs) return false;
      const lot = event.lot!;
      if (event.top === YOU) {
        give(state, content, lot);
        sendLetter(state, words.letters['won']!, { lot: lot.name, price: String(event.price) });
      } else if (event.mine && event.top) {
        sendLetter(state, words.letters['lost']!, { lot: lot.name, who: event.top, price: String(event.price) });
      }
      return true;
    }
    case 'dump': {
      if (!over) return false;
      const server = findServer(content, event.serverId ?? '');
      const known = state.player.passwords[event.serverId ?? ''];
      if (known) {
        const kept = known.filter((user) => !(event.granted ?? []).includes(user));
        if (kept.length > 0) state.player.passwords[event.serverId!] = kept;
        else delete state.player.passwords[event.serverId!];
      }
      sendLetter(state, words.letters['over']!, { company: server?.name ?? 'The company' });
      return true;
    }
    case 'crackdown':
      if (over) sendLetter(state, words.letters['over']!, { shop: findServer(content, event.serverId ?? '')?.name ?? 'The market' });
      return over;
    case 'runner': {
      if (event.jobId && state.contracts.completed.includes(event.jobId)) {
        state.events.owed.push(event.rivalId!);
        sendLetter(state, words.letters['owed']!, { who: handleOf(content, event.rivalId!), company: findServer(content, event.serverId ?? '')?.name ?? 'the company' });
        return true;
      }
      break;
    }
    case 'bounty':
    case 'offer':
      break;
  }
  // The rest are over when their job has gone from the board, or their time is up and nobody is working on it.
  if (!eventJob(state, event)) return true;
  return over && state.contracts.activeId !== event.jobId;
}

/**
 * Moves the darknet on: the event under way runs and ends, and when its
 * time comes the next begins. Called once a game minute. Cheap when there
 * is nothing to do.
 */
export function advanceEvents(state: GameState, content: Content): void {
  const def = content.events;
  if (!def) return;
  const now = state.clock.gameTimeMs;
  const current = state.events.current;
  if (current) {
    if (run(state, content, def, current)) close(state);
    return;
  }
  if (state.player.rating < EVENTS_RATING) return;
  const rng = stream(state, 'events');
  if (state.events.nextMs === 0) {
    // The first comes a little while after the rating is reached, not on the minute.
    state.events.nextMs = now + rng.range(2, 10) * HOUR;
    return;
  }
  if (now < state.events.nextMs) return;
  // Every kind has its turn before any comes round again. The ones that have had theirs stand in only if none of the rest can happen.
  if (EVENT_KINDS.every((kind) => state.events.recent.includes(kind))) state.events.recent = state.events.last ? [state.events.last] : [];
  const fresh = rng.shuffle(EVENT_KINDS.filter((kind) => !state.events.recent.includes(kind)));
  const stale = rng.shuffle(EVENT_KINDS.filter((kind) => state.events.recent.includes(kind) && kind !== state.events.last));
  for (const kind of [...fresh, ...stale]) {
    if (startEvent(state, content, kind)) return;
  }
  // Nothing could happen just now. Look again later.
  state.events.nextMs = now + 6 * HOUR;
}

/** Starts one kind of event now, if it can happen and nothing else is. True if it began. */
export function startEvent(state: GameState, content: Content, kind: EventKind): boolean {
  const def = content.events;
  if (!def || state.events.current) return false;
  const now = state.clock.gameTimeMs;
  const rng = stream(state, 'events');
  const made = MAKERS[kind](state, content, def[kind], rng, { id: `e${state.nextId++}`, startMs: now });
  if (!made) return false;
  state.events.current = made.event;
  state.events.last = kind;
  if (!state.events.recent.includes(kind)) state.events.recent.push(kind);
  state.events.nextMs = now + rng.range(EVENT_GAP_HOURS[0], EVENT_GAP_HOURS[1]) * HOUR;
  sendLetter(state, def[kind].letter, made.values);
  return true;
}

const auctionNow = (state: GameState): DarkEvent | undefined => (state.events.current?.kind === 'auction' ? state.events.current : undefined);

/** Bids one step over the highest bid in the auction. The money is held, and comes back if someone goes over. */
export function bidAtAuction(state: GameState, content: Content): string | null {
  const event = auctionNow(state);
  if (!event || !content.events) return 'There is no auction on.';
  if (event.top === YOU) return 'Yours is already the highest bid.';
  const bid = nextBid(event);
  if (state.player.balance < bid) return 'You cannot afford that bid.';
  const now = state.clock.gameTimeMs;
  state.player.balance -= bid;
  event.top = YOU;
  event.price = bid;
  event.mine = true;
  if (event.untilMs - now < HOUR) event.untilMs = now + HOUR;
  // Anyone with room to go over it does, before long.
  const rng = stream(state, 'events');
  const able = (event.runners ?? []).filter((item) => (item.cap ?? 0) >= nextBid(event));
  if (able.length > 0) {
    event.moments = [...(event.moments ?? []), { atMs: now + rng.range(10, 50) * 60_000, who: rng.pick(able).who }].sort((a, b) => a.atMs - b.atMs);
  }
  return null;
}

/** Buys the lot outright. The bidding closes. */
export function buyAtAuction(state: GameState, content: Content): string | null {
  const event = auctionNow(state);
  if (!event || !content.events) return 'There is no auction on.';
  const lot = event.lot!;
  const held = event.top === YOU ? (event.price ?? 0) : 0;
  const price = buyNowPrice(lot);
  if (state.player.balance + held < price) return 'You cannot afford that.';
  state.player.balance += held - price;
  give(state, content, lot);
  sendLetter(state, content.events.auction.letters['bought']!, { lot: lot.name, price: String(price) });
  close(state);
  return null;
}

/**
 * Tells Halyard the private offer smells wrong. If it was a trap, Halyard
 * pays for the warning; if not, the client takes the work elsewhere.
 */
export function reportOffer(state: GameState, content: Content): string | null {
  const event = state.events.current;
  const job = eventJob(state);
  if (event?.kind !== 'offer' || !job || !content.events) return 'There is no offer to report.';
  if (state.contracts.activeId === job.id) return 'You have taken the job. Give it up first.';
  const words = content.events.offer;
  state.contracts.jobs = state.contracts.jobs.filter((item) => item.id !== job.id);
  if (event.sting) {
    const server = findServer(content, job.targetId);
    const pay = fifty((server ? usualPay(content, server) : job.pay) * WARNING_PAY);
    state.player.balance += pay;
    shiftStanding(state, content, 'halyard', 1);
    sendLetter(state, words.letters['rightCall']!, { pay: String(pay) });
  } else {
    sendLetter(state, words.letters['wrongCall']!);
  }
  close(state);
  return null;
}

/**
 * A connection has just opened. If it is to the company a trap was baited
 * with, and the player took the bait, the trap closes: the trace is under
 * way at once and runs fast, the job is gone and there is a fee to pay.
 * `withdraw` takes the job off the player's hands (see contracts.ts).
 */
export function springSting(state: GameState, content: Content, connection: Connection, withdraw: () => void): boolean {
  const event = state.events.current;
  const job = eventJob(state);
  if (event?.kind !== 'offer' || !event.sting || !job || !content.events) return false;
  if (state.contracts.activeId !== job.id || connection.serverId !== job.targetId) return false;
  const server = findServer(content, job.targetId);
  const fine = Math.min(state.player.balance, server ? usualPay(content, server) : 0);
  state.player.balance -= fine;
  connection.trace.status = 'active';
  connection.trace.graceMs = 0;
  connection.trace.hopMs = connection.trace.hopMs.map((ms) => ms * STING_TRACE);
  withdraw();
  sendLetter(state, content.events.offer.letters['sting']!, { fine: String(fine) });
  close(state);
  return true;
}

/**
 * A race is starting. If the rival owes the player a favour, they stand
 * down and there is no race. True if they did.
 */
export function standsDown(state: GameState, content: Content, rival: string): boolean {
  const id = state.events?.owed.find((item) => handleOf(content, item) === rival);
  if (id === undefined || !content.events) return false;
  state.events.owed = state.events.owed.filter((item) => item !== id);
  sendLetter(state, content.events.runner.letters['stoodDown']!, { who: rival });
  return true;
}

/** An attack has been lined up. A runner who owes the player a favour warns of it. True if one did. */
export function runnerWarns(state: GameState, content: Content, raider: string): boolean {
  const id = state.events?.owed[0];
  if (id === undefined || !content.events) return false;
  state.events.owed = state.events.owed.slice(1);
  state.events.warned = true;
  sendLetter(state, content.events.runner.letters['warning']!, { who: handleOf(content, id), raider });
  return true;
}

/** The runners who owe the player a favour, by handle. */
export const owedBy = (state: GameState, content: Content): string[] => (state.events?.owed ?? []).map((id) => handleOf(content, id));

/** What a button on an event's page does. */
export type EventButton = 'bid' | 'buy' | 'report';

export interface EventPage {
  /** Address of the darknet site it is on, and its path there. */
  readonly site: string;
  readonly path: string;
  readonly title: string;
  readonly blocks: readonly BlockDef[];
}

/** The path every event's page is at on its site. */
export const EVENT_PATH = '/now';

/** The page for what is happening now, as the game stands. Undefined when nothing is. */
export function eventPage(state: GameState, content: Content): EventPage | undefined {
  const event = state.events?.current;
  const def = content.events;
  if (!event || !def) return undefined;
  const words = def[event.kind];
  const job = eventJob(state, event);
  const server = findServer(content, (event.kind === 'crackdown' ? event.holderId : event.serverId) ?? '');
  const values: Values = {
    company: server?.name ?? '',
    city: server?.city ?? '',
    hours: String(hoursLeft(state, event)),
    days: String(EVENT_HOURS.crackdown / 24),
    percent: String(Math.round((CRACKDOWN_PRICES - 1) * 100)),
    shop: event.kind === 'crackdown' ? (findServer(content, event.serverId ?? '')?.name ?? '') : '',
    who: event.rivalId ? handleOf(content, event.rivalId) : '',
    client: job?.client ?? '',
    account: event.account ?? '',
    trade: event.trade ?? '',
    pay: String(event.pay ?? job?.pay ?? 0),
    goal: job?.summary ?? '',
    file: job && 'file' in job.objective ? job.objective.file : '',
    lot: event.lot?.name ?? '',
    price: String(event.price ?? 0),
    buy: event.lot ? String(buyNowPrice(event.lot)) : '',
    runners: (event.runners ?? []).map((item) => item.who).join(', '),
  };
  const press = (text: string, does: EventButton, off?: string): BlockDef => ({ button: { text, does, ...(off ? { off } : {}) } });
  const blocks: BlockDef[] = [{ h: fill(words.title, values) }, { p: `${hoursLeft(state, event)} h left` }, ...words.lines.map((line) => ({ p: fill(line, values) }))];
  if (event.kind === 'auction' && event.lot) {
    const mine = event.top === YOU;
    blocks.push({ p: event.top === '' ? `No bids yet. Bidding opens at ${event.price} credits.` : `Highest bid: ${event.price} credits, by ${mine ? 'you' : event.top}.` });
    blocks.push({ list: (event.runners ?? []).map((item) => `${item.who} is bidding`) });
    blocks.push(mine ? { p: 'Yours is the highest bid. You will hear if someone goes over it.' } : press(`Bid ${nextBid(event)} credits`, 'bid', state.player.balance < nextBid(event) ? 'You cannot afford that bid.' : undefined));
    const held = mine ? (event.price ?? 0) : 0;
    blocks.push(press(`Buy it now for ${buyNowPrice(event.lot)} credits`, 'buy', state.player.balance + held < buyNowPrice(event.lot) ? 'You cannot afford that.' : undefined));
  }
  if (event.kind === 'bounty') {
    const steps = words.words['progress']!;
    const now = state.clock.gameTimeMs;
    blocks.push({
      list: (event.runners ?? []).map((item) => {
        const share = Math.max(0, Math.min(0.999, (now - (item.fromMs ?? event.startMs)) / Math.max(1, (item.doneMs ?? event.untilMs) - (item.fromMs ?? event.startMs))));
        return `${item.who} ${steps[Math.floor(share * steps.length)]}`;
      }),
    });
  }
  if (event.kind === 'offer') {
    blocks.push(press('Tell Halyard this posting smells wrong', 'report', job && state.contracts.activeId === job.id ? 'You have taken the job. Give it up first.' : undefined));
  }
  if (job && event.kind !== 'offer') blocks.push({ p: state.contracts.activeId === job.id ? 'You have taken this job.' : 'The job is on the board.' });
  return { site: words.site, path: EVENT_PATH, title: fill(words.title, values), blocks };
}
