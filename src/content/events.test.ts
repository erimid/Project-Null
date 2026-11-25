import { describe, expect, it } from 'vitest';
import { applyAction, createGame, deserializeGame, eventPage, postJobs, sellsModule, sellsProgram, serializeGame, shopFor, syncWithContent, worldFor, type Content, type GameState } from '../core';
import { deliverContract } from '../core/contracts';
import { EVENTS_RATING, EVENT_GAP_HOURS, EVENT_HOURS, YOU, buyNowPrice, eventJob, nextBid, owedBy, runnerWarns, standsDown, startEvent } from '../core/events';
import { beginRaid } from '../core/raid';
import { MIGRATIONS } from '../core/save';
import { advanceContract, startContract } from '../core/stages';
import type { DarkEvent, Job } from '../core/state';
import { partCount } from '../core/crafting';
import { EVENT_KINDS, type EventKind } from './events';
import { assets, companies, contracts, events, gameInfo, hardware, ladder, mail, models, modules, news, patrons, people, programs, rivals, servers, skills, story, tuning } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, events, assets, rules: tuning };
const SEED = 31;
const content = worldFor(written, SEED);
const HOUR = 3_600_000;

const newGame = (rating = 40, seed = SEED): GameState => {
  const state = syncWithContent(createGame({ seed, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), worldFor(written, seed));
  state.player.rating = rating;
  state.player.balance = 100_000;
  postJobs(state, content);
  return state;
};

/** Lets game time pass, with the board looked at every quarter of an hour. */
function wait(state: GameState, hours: number, world: Content = content): void {
  for (let i = 0; i < hours * 4; i++) {
    state.clock.gameTimeMs += HOUR / 4;
    postJobs(state, world);
  }
}

/** A game in which one kind of event has just begun. */
function during(kind: EventKind, fits: (event: DarkEvent) => boolean = () => true, rating = 40): { state: GameState; event: DarkEvent } {
  for (let seed = SEED; seed < SEED + 60; seed++) {
    const state = newGame(rating);
    state.rngStreams['events'] = seed;
    if (!startEvent(state, content, kind)) continue;
    const event = state.events.current!;
    if (fits(event)) return { state, event };
  }
  throw new Error(`no ${kind} that fits`);
}

function take(state: GameState, job: Job): Job {
  state.contracts.activeId = job.id;
  startContract(state, content, job);
  advanceContract(state, content, job);
  return job;
}

const lastMail = (state: GameState) => state.messages[state.messages.length - 1]!;
const filled = (text: string) => expect(text).not.toMatch(/\{\w+\}/);

describe('darknet events: when they come', () => {
  it('nothing happens, and the board is as it was, below the rating they start at', () => {
    const without: Content = { ...content, events: undefined };
    const boards = [content, without].map((world) => {
      const state = newGame(EVENTS_RATING - 1);
      const seen: string[] = [];
      for (let round = 0; round < 12; round++) {
        wait(state, tuning.jobHours + 1, world);
        seen.push(...state.contracts.jobs.map((job) => `${job.title}/${job.targetId}/${job.pay}/${JSON.stringify(job.objective)}`));
      }
      expect(state.events.current).toBeNull();
      return [...seen, ...state.messages.map((mail) => mail.subject)];
    });
    expect(boards[0]).toEqual(boards[1]);
  });

  it('one at a time, two or three game days apart, never the same kind twice running, and every kind turns up', () => {
    const state = newGame(40);
    const starts: { kind: EventKind; atMs: number }[] = [];
    let before: string | undefined;
    for (let quarter = 0; quarter < 60 * 24 * 4; quarter++) {
      state.clock.gameTimeMs += HOUR / 4;
      postJobs(state, content);
      const now = state.events.current;
      if (now && now.id !== before) starts.push({ kind: now.kind, atMs: now.startMs });
      before = now?.id ?? before;
    }
    expect(starts.length).toBeGreaterThanOrEqual(18);
    expect(starts.length).toBeLessThanOrEqual(30);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!.kind, `event ${i}`).not.toBe(starts[i - 1]!.kind);
      expect((starts[i]!.atMs - starts[i - 1]!.atMs) / HOUR).toBeGreaterThanOrEqual(EVENT_GAP_HOURS[0]);
    }
    // Every kind has its turn before any comes round again.
    expect(new Set(starts.slice(0, EVENT_KINDS.length).map((start) => start.kind)).size).toBe(EVENT_KINDS.length);
  });

  it.each(EVENT_KINDS)('%s: arrives as a letter, has a page on a darknet site, and nothing is left to fill in', (kind) => {
    const { state, event } = during(kind);
    const letter = lastMail(state);
    filled(`${letter.from} ${letter.subject} ${letter.body}`);
    const page = eventPage(state, content)!;
    expect(['lowtide.veil', 'glasshouse.veil', 'index.veil']).toContain(page.site);
    filled(JSON.stringify(page.blocks));
    const job = eventJob(state);
    if (kind !== 'auction') {
      expect(job, 'its job').toBeDefined();
      expect(job!.dark).toBe(true);
      filled(`${job!.title} ${job!.summary} ${job!.brief} ${job!.news}`);
      expect(job!.expiresMs).toBe(event.untilMs);
    }
    // It ends, and the next does not begin on its heels.
    wait(state, EVENT_HOURS[kind] + 1);
    expect(state.events.current).toBeNull();
    expect(state.events.nextMs).toBeGreaterThan(state.clock.gameTimeMs);
  });

  it('no wording names the story’s secret', () => {
    expect(JSON.stringify(events)).not.toMatch(/project null/i);
  });
});

describe('the Lowtide auction', () => {
  it('a bid is held, comes back when a runner goes over it, and the lot goes to the highest bidder at the close', () => {
    const { state, event } = during('auction', (item) => item.lot!.kind === 'module');
    const lot = event.lot!;
    const before = state.player.balance;
    const had = partCount(state, lot.id, lot.grade!);
    let spent = 0;
    // Keep bidding whenever someone else is on top, until the close.
    for (let quarter = 0; quarter < 40 * 4 && state.events.current; quarter++) {
      if (event.top !== YOU) {
        const bid = nextBid(event);
        expect(applyAction(state, { type: 'eventBid' }, content).ok).toBe(true);
        expect(state.player.balance).toBe(before - bid);
        spent = bid;
      }
      state.clock.gameTimeMs += HOUR / 4;
      postJobs(state, content);
    }
    expect(state.events.current).toBeNull();
    expect(partCount(state, lot.id, lot.grade!)).toBe(had + 1);
    expect(state.player.balance).toBe(before - spent);
    // Nobody bids past their limit, so it never costs more than the dearest runner would pay.
    const top = Math.max(...event.runners!.map((runner) => runner.cap!));
    expect(spent).toBeLessThanOrEqual(top + lot.list * 0.06);
    expect(spent).toBeLessThan(buyNowPrice(lot));
    expect(lastMail(state).subject).toContain('Yours');
    expect(state.messages.some((mail) => mail.subject.startsWith('Outbid'))).toBe(true);
  });

  it('left alone, it goes to a runner and costs the player nothing', () => {
    const { state, event } = during('auction');
    const before = state.player.balance;
    const mail = state.messages.length;
    wait(state, EVENT_HOURS.auction + 2);
    expect(state.events.current).toBeNull();
    expect(event.top).not.toBe(YOU);
    expect(state.player.balance).toBe(before);
    expect(state.messages.length).toBe(mail);
  });

  it('can be bought outright: the bid held comes back and the bidding closes', () => {
    const { state, event } = during('auction', (item) => item.lot!.kind === 'module');
    const lot = event.lot!;
    const before = state.player.balance;
    applyAction(state, { type: 'eventBid' }, content);
    expect(applyAction(state, { type: 'eventBuy' }, content).ok).toBe(true);
    expect(state.player.balance).toBe(before - buyNowPrice(lot));
    expect(partCount(state, lot.id, lot.grade!)).toBe(1);
    expect(state.events.current).toBeNull();
    state.player.balance = 0;
    const again = during('auction').state;
    again.player.balance = 0;
    expect(applyAction(again, { type: 'eventBid' }, content).ok).toBe(false);
    expect(applyAction(again, { type: 'eventBuy' }, content).ok).toBe(false);
  });

  it('a hardware lot is a part better than the gateway has, and is fitted when won', () => {
    const { state, event } = during('auction', (item) => item.lot!.kind === 'hardware');
    const part = hardware.find((item) => item.id === event.lot!.id)!;
    expect(part.tier).toBeGreaterThan(state.player.hardware[part.slot]);
    applyAction(state, { type: 'eventBuy' }, content);
    expect(state.player.hardware[part.slot]).toBe(part.tier);
  });
});

describe('the open bounty', () => {
  it('is lost the moment the first of the other runners finishes, taken or not', () => {
    const { state, event } = during('bounty');
    const job = eventJob(state)!;
    expect(job.objective.kind).toBe('steal');
    expect(event.runners!.length).toBeGreaterThanOrEqual(2);
    expect(event.untilMs).toBe(Math.min(...event.runners!.map((runner) => runner.doneMs!)));
    take(state, job);
    expect(state.contracts.raceUntilMs).toBe(event.untilMs);
    state.clock.gameTimeMs = event.untilMs + 60_000;
    advanceContract(state, content, job);
    expect(state.contracts.activeId).toBeNull();
    expect(lastMail(state).body).toContain(job.race!.rival);
    postJobs(state, content);
    expect(state.events.current).toBeNull();
  });

  it('pays well over the usual, and its page says how far along each runner is', () => {
    const { state, event } = during('bounty');
    const job = eventJob(state)!;
    const usual = tuning.jobPay[content.servers.find((server) => server.id === job.targetId)!.generated!.tier - 1]!;
    expect(job.pay).toBeGreaterThan(usual * 1.5);
    const text = JSON.stringify(eventPage(state, content)!.blocks);
    for (const runner of event.runners!) expect(text).toContain(runner.who);
    expect(text).toContain(events.bounty.words['progress']![0]);
  });

  it('a runner who owes a favour pulls out of it', () => {
    const state = newGame(40);
    state.events.owed = ladder.rivals.filter((rival) => !rival.raider).map((rival) => rival.id);
    expect(startEvent(state, content, 'bounty')).toBe(true);
    expect(state.events.current!.runners!.length).toBe(2);
    expect(state.events.owed.length).toBe(ladder.rivals.filter((rival) => !rival.raider).length - 1);
    expect(state.messages.some((mail) => mail.subject === 'That bounty')).toBe(true);
  });
});

describe('the password dump', () => {
  it('hands over every login at a company for twelve hours, and the company watches harder meanwhile', () => {
    const { state, event } = during('dump');
    const server = content.servers.find((item) => item.id === event.serverId)!;
    const admin = server.accounts.find((account) => account.role === 'admin')!;
    expect(state.player.passwords[server.id]).toContain(admin.user);
    expect(state.servers[server.id]!.alert?.raise.monitor).toBe(1);
    expect(state.knownServers).toContain(server.id);
    wait(state, EVENT_HOURS.dump - 1);
    expect(state.player.passwords[server.id]).toContain(admin.user);
    wait(state, 2);
    expect(state.player.passwords[server.id]).toBeUndefined();
    expect(lastMail(state).subject).toContain('Closed');
  });

  it('a login the player already had is not taken away at the reset', () => {
    const { state, event } = during('dump', (item) => content.servers.find((server) => server.id === item.serverId)!.accounts.length > 1);
    const server = content.servers.find((item) => item.id === event.serverId)!;
    const guest = server.accounts.find((account) => account.role !== 'admin')!;
    // As if it had been known before: not one of those handed over.
    event.granted = event.granted!.filter((user) => user !== guest.user);
    wait(state, EVENT_HOURS.dump + 1);
    expect(state.player.passwords[server.id]).toEqual([guest.user]);
  });
});

describe('the crackdown', () => {
  it('shuts one market for two days, puts prices up at the others, and then lifts', () => {
    const { state, event } = during('crackdown');
    const shut = content.servers.find((item) => item.id === event.serverId)!;
    const open = content.servers.filter((item) => item.kind === 'board' && item.id !== shut.id);
    expect(shut.shop?.contracts).toBe(false);
    expect(programs.some((program) => sellsProgram(state, shut, program))).toBe(false);
    expect(modules.some((module) => sellsModule(state, shut, module, 1))).toBe(false);
    for (const shop of open) expect(shopFor(state, content, shop).priceFactor).toBeCloseTo((shop.shop?.priceFactor ?? 1) * 1.15);
    wait(state, EVENT_HOURS.crackdown + 1);
    for (const shop of [shut, ...open]) expect(shopFor(state, content, shop).priceFactor).toBeCloseTo(shop.shop?.priceFactor ?? 1);
    expect(programs.some((program) => sellsProgram(state, shut, program)) || modules.some((module) => sellsModule(state, shut, module, 1)) || shut.shop?.hardware).toBeTruthy();
    expect(lastMail(state).subject).toContain('is back');
  });

  it('its job is to copy the list of what was seized, which is there once the job is taken', () => {
    const { state } = during('crackdown');
    const job = eventJob(state)!;
    expect(job.objective.kind).toBe('steal');
    const file = (job.objective as { file: string }).file;
    expect(state.servers[job.targetId]!.files.some((item) => item.name === file)).toBe(false);
    take(state, job);
    expect(state.servers[job.targetId]!.files.some((item) => item.name === file)).toBe(true);
  });
});

/** Does the wipe job a runner asked for, and hands it in. */
function helpRunner(state: GameState): string {
  const event = state.events.current!;
  const job = take(state, eventJob(state)!);
  expect(job.objective.kind).toBe('wipe');
  const logs = state.servers[job.targetId]!.logs;
  const who = (job.objective as { who: string }).who;
  expect(logs.some((line) => line.text.includes(who))).toBe(true);
  state.servers[job.targetId]!.logs = logs.filter((line) => !line.text.includes(who));
  advanceContract(state, content, job);
  expect(deliverContract(state, content)).toBeNull();
  return event.rivalId!;
}

describe('a runner in trouble', () => {
  it('pays little, and leaves the runner owing a favour', () => {
    const { state, event } = during('runner');
    const job = eventJob(state)!;
    const usual = tuning.jobPay[content.servers.find((server) => server.id === job.targetId)!.generated!.tier - 1]!;
    expect(job.pay).toBeLessThan(usual);
    expect(ladder.rivals.find((rival) => rival.id === event.rivalId)!.raider).toBe(false);
    const id = helpRunner(state);
    expect(state.events.owed).toEqual([id]);
    expect(state.events.current).toBeNull();
    expect(state.messages.some((mail) => mail.subject === 'I owe you')).toBe(true);
    expect(owedBy(state, content)).toEqual([job.client]);
  });

  it('not helped, nobody owes anything', () => {
    const { state } = during('runner');
    wait(state, EVENT_HOURS.runner + 1);
    expect(state.events.owed).toEqual([]);
    expect(state.events.current).toBeNull();
  });

  it('the favour is paid by standing down from one race, once', () => {
    const { state } = during('runner');
    const who = eventJob(state)!.client;
    helpRunner(state);
    const race: Job = { ...state.contracts.jobs.find((job) => !job.stages && !job.race && job.objective.kind !== 'wipe')!, race: { rival: who, minutes: 200 } };
    take(state, race);
    expect(state.contracts.raceUntilMs).toBe(0);
    expect(lastMail(state).subject).toBe('It is yours');
    expect(state.events.owed).toEqual([]);
    expect(standsDown(state, content, who)).toBe(false);
  });

  it('or by a warning before a raid, which leaves the player readier for it', () => {
    const { state } = during('runner');
    helpRunner(state);
    const raider = rivals.find((rival) => !rival.storyOnly)!;
    expect(runnerWarns(state, content, raider.handle)).toBe(true);
    expect(lastMail(state).body).toContain(raider.handle);
    expect(state.events.owed).toEqual([]);
    const plain = newGame(40);
    beginRaid(plain, content, raider.id);
    beginRaid(state, content, raider.id);
    expect(state.raid!.breachTotalMs).toBeGreaterThan(plain.raid!.breachTotalMs);
    expect(state.events.warned).toBe(false);
  });
});

describe('the private offer', () => {
  it('half are a trap; a trap has two or three tells and an honest offer none', () => {
    let traps = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const state = newGame(40);
      state.rngStreams['events'] = seed * 7919;
      if (!startEvent(state, content, 'offer')) continue;
      const event = state.events.current!;
      const job = eventJob(state)!;
      const server = content.servers.find((item) => item.id === job.targetId)!;
      const usual = tuning.jobPay[server.generated!.tier - 1]!;
      const called = Object.fromEntries(events.offer.words['trades']!.map((line) => line.split('=')));
      const tells = [/opened|New account/.test(event.account!), job.pay > usual * 2.2, event.trade !== called[server.generated!.sector]].filter(Boolean).length;
      if (event.sting) traps++;
      if (event.sting) expect(tells, `trap, seed ${seed}`).toBeGreaterThanOrEqual(2);
      else expect(tells, `honest, seed ${seed}`).toBe(0);
      // The job itself gives nothing away.
      expect(Object.keys(job)).not.toContain('sting');
      expect(`${job.title} ${job.brief}`).not.toMatch(/\btrap\b|\bbait\b/i);
    }
    expect(traps).toBeGreaterThan(18);
    expect(traps).toBeLessThan(42);
  });

  it('reporting a trap is paid for; reporting an honest offer loses the work and nothing else', () => {
    const trap = during('offer', (event) => event.sting === true).state;
    const before = trap.player.balance;
    expect(applyAction(trap, { type: 'eventReport' }, content).ok).toBe(true);
    expect(trap.player.balance).toBeGreaterThan(before);
    expect(lastMail(trap).subject).toBe('Good call');
    expect(trap.events.current).toBeNull();
    expect(trap.contracts.jobs.some((job) => job.dark)).toBe(false);

    const honest = during('offer', (event) => event.sting === false).state;
    const had = honest.player.balance;
    expect(applyAction(honest, { type: 'eventReport' }, content).ok).toBe(true);
    expect(honest.player.balance).toBe(had);
    expect(honest.player.rating).toBe(40);
    expect(lastMail(honest).subject).toBe('That one was real');
    expect(honest.contracts.jobs.some((job) => job.dark)).toBe(false);
  });

  it('a trap closes on connecting: a fast trace at once, a fee, and the job gone; the career goes on', () => {
    const { state } = during('offer', (event) => event.sting === true);
    const job = take(state, eventJob(state)!);
    const before = state.player.balance;
    const rating = state.player.rating;
    state.knownServers.push(job.targetId);
    expect(applyAction(state, { type: 'connect', serverId: job.targetId }, content).ok).toBe(true);
    const connection = state.connections[0]!;
    expect(connection.trace.status).toBe('active');
    expect(state.contracts.activeId).toBeNull();
    expect(state.contracts.jobs.some((item) => item.id === job.id)).toBe(false);
    expect(state.player.balance).toBeLessThan(before);
    expect(state.player.balance).toBeGreaterThan(before * 0.8);
    expect(state.player.rating).toBe(rating);
    expect(lastMail(state).subject).toBe('That offer was a trap');
    // Hanging up in time is the end of it.
    expect(applyAction(state, { type: 'disconnect', connectionId: connection.id }, content).ok).toBe(true);
    expect(state.player.lieLowUntilMs).toBe(0);
  });

  it('an honest offer is an ordinary job that pays half as much again', () => {
    const { state } = during('offer', (event) => event.sting === false);
    const job = take(state, eventJob(state)!);
    state.knownServers.push(job.targetId);
    applyAction(state, { type: 'connect', serverId: job.targetId }, content);
    expect(state.connections[0]!.trace.status).not.toBe('active');
    expect(state.contracts.activeId).toBe(job.id);
    expect(applyAction(state, { type: 'eventReport' }, content).ok).toBe(false);
  });
});

describe('saving', () => {
  it('an event under way survives saving and loading', () => {
    const { state } = during('auction');
    applyAction(state, { type: 'eventBid' }, content);
    const loaded = deserializeGame(serializeGame(state, new Date().toISOString())).state;
    expect(loaded.events).toEqual(state.events);
  });

  it('a save from before them loads with nothing happening', () => {
    const old = JSON.parse(JSON.stringify(newGame(40))) as Record<string, unknown>;
    delete old['events'];
    expect(MIGRATIONS[32]!(old)['events']).toEqual({ current: null, nextMs: 0, last: null, recent: [], owed: [], warned: false });
  });
});
