import { describe, expect, it } from 'vitest';
import { applyAction, createGame, deserializeGame, serializeGame, syncWithContent, worldFor, type Connection, type Content, type GameState } from '../core';
import { CLIENT_PREMIUM, DATA_BOARD, ENCRYPTED_CUT, HALF_LIFE_DAYS, BETRAYAL_STANDING, dataKind, daySwing, priceBoard, quote } from '../core/data';
import { startContract } from '../core/stages';
import { standingWith } from '../core/patrons';
import { parseData } from './data';
import { ContentError } from './schema';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder, data, type ContractDef } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, data, rules: tuning };
const SEED = 51;
const content = worldFor(written, SEED);
const company = (tier: number) => content.servers.find((server) => server.generated?.tier === tier)!;
const DAY = 24 * 3_600_000;

const newGame = (): GameState => syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
function atLowtide(state: GameState): Connection {
  const connection: Connection = {
    id: 'lt',
    serverId: DATA_BOARD,
    route: [],
    user: 'guest',
    role: 'guest',
    openedAtMs: state.clock.gameTimeMs,
    bypassed: { proxy: false, firewall: false },
    trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [600_000] },
    reroutes: 0,
    monitor: { blindMs: 0, used: false, echo: null },
  };
  state.connections.push(connection);
  return connection;
}
const steal = (state: GameState, name: string, from: string, extra: object = {}) => {
  const file = { name, sizeGq: 4, from, takenMs: state.clock.gameTimeMs, ...extra };
  state.player.files.push(file);
  return file;
};
const price = (state: GameState, file: Parameters<typeof quote>[2]) => {
  const offer = quote(state, content, file);
  if (typeof offer === 'string') throw new Error(offer);
  return offer.price;
};

describe('the data market', () => {
  it('knows a file by the words in its name', () => {
    expect(dataKind(content, 'payroll_2034.dat')!.id).toBe('ledgers');
    expect(dataKind(content, 'board_minutes.txt')!.id).toBe('mail');
    expect(dataKind(content, 'vault_keys.bin')!.id).toBe('keys');
    expect(dataKind(content, 'xyz.arc')!.id).toBe('other');
  });

  it('moves prices by the day, the same for everyone on the same day', () => {
    const state = newGame();
    const swings = new Set<number>();
    for (let day = 0; day < 10; day++) swings.add(daySwing(state, 'ledgers', day));
    expect(swings.size).toBeGreaterThan(5);
    for (const swing of swings) expect(swing).toBeGreaterThanOrEqual(0.6);
    expect(daySwing(state, 'ledgers', 3)).toBe(daySwing(newGame(), 'ledgers', 3));
    expect(priceBoard(state, content)).toHaveLength(data.kinds.length + 1);
  });

  it('pays more for a better-guarded company, less as the file ages, and less once the victim is in the news', () => {
    const state = newGame();
    const low = steal(state, 'payroll.dat', company(1).id);
    const high = steal(state, 'payroll.dat', company(5).id);
    expect(price(state, high)).toBeGreaterThan(price(state, low));
    // Age: same day's swing, so compare by moving the taken time instead of the clock.
    const fresh = price(state, low);
    const old = price(state, { ...low, takenMs: state.clock.gameTimeMs - HALF_LIFE_DAYS * DAY });
    expect(old / fresh).toBeCloseTo(0.5, 1);
    const sealed = price(state, { ...low, encrypted: 2 });
    expect(sealed / fresh).toBeCloseTo(ENCRYPTED_CUT, 1);
    state.news.editions.push({ day: 999_999, weather: '', items: [{ kind: 'job', serverId: low.from, headline: 'h', body: 'b' }] } as never);
    const quoted = quote(state, content, low);
    expect(typeof quoted !== 'string' && quoted.inNews).toBe(true);
  });

  it('buys a file once, and not what a client sent or a module', () => {
    const state = newGame();
    const connection = atLowtide(state);
    const file = steal(state, 'board_minutes.txt', company(2).id);
    const before = state.player.balance;
    const offered = price(state, file);
    expect(applyAction(state, { type: 'sellData', connectionId: connection.id, name: file.name, from: file.from }, content)).toEqual({ ok: true });
    expect(state.player.balance).toBe(before + offered);
    expect(state.player.files.some((item) => item.name === file.name)).toBe(false);
    steal(state, 'board_minutes.txt', company(2).id);
    expect(quote(state, content, state.player.files.at(-1)!)).toMatch(/already has/);
    expect(quote(state, content, { name: 'plant.dat', sizeGq: 1, from: 'client' })).toMatch(/client/);
  });

  it('pays double for the file a client is waiting for, and the job and the standing go with it', () => {
    const state = newGame();
    const target = company(3);
    const job: ContractDef & { expiresMs: number } = {
      id: 'job-x',
      title: 'Copy it',
      client: 'Halyard',
      patron: 'halyard',
      targetId: target.id,
      pay: 1500,
      rating: 1,
      minRating: 0,
      summary: 's',
      brief: 'b',
      objective: { kind: 'steal', file: 'secret_design.dat' },
      expiresMs: state.clock.gameTimeMs + DAY,
    };
    state.contracts.jobs.push(job);
    state.contracts.activeId = job.id;
    startContract(state, content, job);
    state.patrons.standing.halyard = 5;
    const file = steal(state, 'secret_design.dat', target.id);
    const offer = quote(state, content, file);
    expect(typeof offer !== 'string' && offer.betrays?.id).toBe('job-x');
    expect(typeof offer !== 'string' && offer.price).toBeGreaterThanOrEqual(job.pay * CLIENT_PREMIUM);
    const connection = atLowtide(state);
    expect(applyAction(state, { type: 'sellData', connectionId: connection.id, name: file.name, from: file.from }, content)).toEqual({ ok: true });
    expect(state.contracts.activeId).toBeNull();
    expect(standingWith(state, 'halyard')).toBeLessThanOrEqual(5 - BETRAYAL_STANDING);
    expect(state.messages.at(-1)!.body).toMatch(/Lowtide/);
  });

  it('only buys at Lowtide', () => {
    const state = newGame();
    const file = steal(state, 'payroll.dat', company(1).id);
    expect(applyAction(state, { type: 'sellData', connectionId: 'nope', name: file.name, from: file.from }, content).ok).toBe(false);
  });

  it('keeps when a file was taken, and what it has bought, through a save', () => {
    const state = newGame();
    steal(state, 'payroll.dat', company(1).id);
    state.data.sold.push('x:y');
    const loaded = deserializeGame(serializeGame(state, '2034-03-14T09:00:00Z')).state;
    expect(loaded.player.files.at(-1)!.takenMs).toBe(state.clock.gameTimeMs);
    expect(loaded.data.sold).toEqual(['x:y']);
  });

  it('checks its data file', () => {
    expect(() => parseData({ buyer: 'L', kinds: [], other: {} })).toThrow(ContentError);
    expect(() => parseData({ ...JSON.parse(JSON.stringify(data)), kinds: [{ ...data.kinds[0], base: -1 }] })).toThrow(ContentError);
  });
});
