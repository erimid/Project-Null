import { describe, expect, it } from 'vitest';
import { availableContracts, createGame, deserializeGame, postJobs, securityOf, serializeGame, syncWithContent, worldFor, type Connection, type Content, type GameState } from '../core';
import { abandonContract, punish } from '../core/contracts';
import { HEIST_PAY, HEIST_TIER, LOCKDOWN, absentAllies, advanceHeist, heistLines, heistRefusal, postHeist } from '../core/heists';
import { startContract } from '../core/stages';
import { ContentError, checkContent, parseContracts } from './schema';
import { assets, companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder, type ContractDef } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, assets, rules: tuning };
const SEED = 41;
const world = worldFor(written, SEED);
const admins = world.servers.filter((server) => server.generated && server.accounts.some((account) => account.role === 'admin'));
const [vault, desk1, desk2] = [admins[0]!, admins[1]!, admins[2]!];

/** A written heist on three generated companies, with an ally who holds the monitor desk for friends of Daylight. */
const HEIST: ContractDef = {
  id: 'test-heist',
  title: 'The vault',
  client: 'A client',
  targetId: vault.id,
  pay: 9000,
  rating: 5,
  minRating: 0,
  summary: 's',
  brief: 'b',
  objective: { kind: 'destroy', file: vault.files[0]!.name },
  heist: {
    holds: [
      { targetId: desk1.id, layer: 'firewall', note: 'The security desk.' },
      { targetId: desk2.id, layer: 'monitor', note: 'The watch desk.', ally: { name: 'Daylight', when: { standing: { daylight: 4 } } } },
    ],
  },
};
const content: Content = { ...world, contracts: [...world.contracts, HEIST] };

const newGame = (): GameState => syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
const ports = (state: GameState, tier: number) => {
  state.player.hardware.ports = tier;
};
let next = 0;
function logIn(state: GameState, serverId: string): Connection {
  const connection: Connection = {
    id: `h${next++}`,
    serverId,
    route: [],
    user: 'admin',
    role: 'admin',
    openedAtMs: state.clock.gameTimeMs,
    bypassed: { proxy: false, firewall: false },
    trace: { status: 'none', graceMs: 0, elapsedMs: 0, hopMs: [600_000] },
    reroutes: 0,
    monitor: { blindMs: 0, used: false, echo: null },
  };
  state.connections.push(connection);
  return connection;
}
function take(state: GameState, contract: ContractDef): void {
  state.contracts.activeId = contract.id;
  startContract(state, content, contract);
}

describe('heists', () => {
  it('shut the vault tight while taken, and each held desk switches its layer off', () => {
    const state = newGame();
    take(state, HEIST);
    expect(securityOf(state, vault).firewall).toBe(LOCKDOWN);
    expect(securityOf(state, vault).monitor).toBe(LOCKDOWN);
    logIn(state, desk1.id);
    expect(securityOf(state, vault).firewall).toBe(0);
    expect(securityOf(state, vault).monitor).toBe(LOCKDOWN);
    // A guest login is not the desk.
    state.connections[0]!.role = 'guest';
    expect(securityOf(state, vault).firewall).toBe(LOCKDOWN);
    // Other servers are untouched.
    expect(securityOf(state, desk1)).toEqual(desk1.security);
  });

  it('let a timed ally hold a door only so long once the player is inside the vault', () => {
    const timed: ContractDef = {
      ...HEIST,
      id: 'timed-heist',
      heist: { holds: [HEIST.heist!.holds[0]!, { ...HEIST.heist!.holds[1]!, ally: { name: 'Wick', seconds: 30, when: {} } }] },
    };
    const state = newGame();
    const local: Content = { ...content, contracts: [...content.contracts, timed] };
    state.contracts.activeId = timed.id;
    startContract(state, local, timed);
    expect(absentAllies(state, timed)).toEqual([]);
    expect(securityOf(state, vault).monitor).toBe(0);
    // The clock only runs while the player is in the vault.
    advanceHeist(state, 40_000);
    expect(securityOf(state, vault).monitor).toBe(0);
    logIn(state, vault.id);
    advanceHeist(state, 20_000);
    expect(securityOf(state, vault).monitor).toBe(0);
    expect(state.contracts.heist!.holds[1]!.allyMs).toBe(10_000);
    advanceHeist(state, 15_000);
    expect(securityOf(state, vault).monitor).toBe(LOCKDOWN);
    // Holding the desk yourself still works after they let go.
    logIn(state, desk2.id);
    expect(securityOf(state, vault).monitor).toBe(0);
  });

  it('say who would have held a door, had things gone differently', () => {
    const state = newGame();
    expect(absentAllies(state, HEIST)).toEqual([{ targetId: desk2.id, name: 'Daylight' }]);
    state.patrons.standing.daylight = 5;
    expect(absentAllies(state, HEIST)).toEqual([]);
  });

  it('need a line for each hold nobody else keeps, and one for the vault', () => {
    const state = newGame();
    expect(heistLines(state, HEIST)).toBe(3);
    ports(state, 2);
    expect(heistRefusal(state, content, HEIST)).toMatch(/needs 3 lines/);
    ports(state, 3);
    expect(heistRefusal(state, content, HEIST)).toBeNull();
    // A friend of Daylight has the watch desk held for them.
    state.patrons.standing.daylight = 5;
    expect(heistLines(state, HEIST)).toBe(2);
    take(state, HEIST);
    expect(securityOf(state, vault).monitor).toBe(0);
  });

  it('burn when the player is caught anywhere, and are never offered again', () => {
    const state = newGame();
    expect(availableContracts(state, content).some((item) => item.id === HEIST.id)).toBe(true);
    take(state, HEIST);
    punish(state, content, desk2.id);
    expect(state.contracts.activeId).toBeNull();
    expect(state.contracts.heist).toBeNull();
    expect(state.contracts.burned).toContain(HEIST.id);
    expect(state.messages.at(-1)!.body).toMatch(/burned/);
    expect(availableContracts(state, content).some((item) => item.id === HEIST.id)).toBe(false);
    // The vault opens up again.
    expect(securityOf(state, vault)).toEqual(vault.security);
  });

  it('burn when given up, too', () => {
    const state = newGame();
    take(state, HEIST);
    expect(abandonContract(state, content)).toBeNull();
    expect(state.contracts.burned).toContain(HEIST.id);
  });

  it('can wait on conditions', () => {
    const gated: Content = { ...content, contracts: [...world.contracts, { ...HEIST, when: { flags: ['met-daylight'], below: { office: 3 } } }] };
    const state = newGame();
    const offered = () => availableContracts(state, gated).some((item) => item.id === HEIST.id);
    expect(offered()).toBe(false);
    state.flags.push('met-daylight');
    expect(offered()).toBe(true);
    state.patrons.standing.office = 4;
    expect(offered()).toBe(false);
  });

  it('are posted on the board from the upper tiers, one at a time, paying several times a job', () => {
    const state = newGame();
    state.player.rating = tuning.tierRatings[HEIST_TIER - 2]!;
    for (let day = 0; day < 10; day++) {
      state.clock.gameTimeMs += 24 * 3_600_000;
      expect(postHeist(state, content)).toBeUndefined();
    }
    state.player.rating = 30;
    let posted = 0;
    for (let day = 0; day < 20; day++) {
      state.clock.gameTimeMs += 24 * 3_600_000;
      postJobs(state, content);
      const heists = state.contracts.jobs.filter((job) => job.heist);
      expect(heists.length).toBeLessThanOrEqual(1);
      for (const job of heists) {
        const tier = content.servers.find((server) => server.id === job.targetId)!.generated!.tier;
        expect(job.pay).toBe(Math.round((tuning.jobPay[tier - 1]! * HEIST_PAY) / 50) * 50);
        const holds = job.heist!.holds.map((hold) => hold.targetId);
        expect(new Set(holds).size).toBe(holds.length);
        expect(holds).not.toContain(job.targetId);
        expect(job.brief + job.title + job.summary).not.toMatch(/\{\w+\}/);
      }
      if (heists.length > 0) {
        posted++;
        // Taken by someone else: gone, and the next day may bring another.
        state.contracts.jobs = state.contracts.jobs.filter((job) => !job.heist);
      }
    }
    expect(posted).toBeGreaterThan(3);
    // The usual jobs are still there beside them.
    expect(state.contracts.jobs.filter((job) => !job.news && !job.heist).length).toBeGreaterThanOrEqual(tuning.boardJobs - 1);
  });

  it('keep their plan through a save', () => {
    const state = newGame();
    take(state, HEIST);
    const loaded = deserializeGame(serializeGame(state, '2034-03-14T09:00:00Z'));
    expect(loaded.state.contracts.heist).toEqual(state.contracts.heist);
  });

  it('are checked when written', () => {
    const raw = JSON.parse(JSON.stringify(HEIST));
    raw.heist.holds[0].layer = 'password';
    expect(() => parseContracts([raw])).toThrow(ContentError);
    const self = { ...HEIST, heist: { holds: [{ targetId: vault.id, layer: 'firewall' as const, note: 'n' }] } };
    expect(() => checkContent(gameInfo, world.servers, programs, [self])).toThrow(/not another server/);
  });
});
