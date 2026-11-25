import { describe, expect, it } from 'vitest';
import { companies } from '../content';
import {
  applyAction,
  availableContracts,
  createGame,
  deserializeGame,
  fileContent,
  generateCompanies,
  isJob,
  regionOf,
  serializeGame,
  syncWithContent,
  tick,
  tierForRating,
  worldFor,
  STATE_VERSION,
  type Action,
  type Content,
  type GameState,
} from './index';
import { postJobs } from './contracts';
import { noteProgress } from './world';
import { content as testContent } from './testWorld';

/** The test world, with the real company pools. */
const base: Content = { ...testContent, companies };
/** The same, with only the three oldest kinds of job and no races. */
const plainBase: Content = { ...base, companies: { ...companies, jobs: { ...companies.jobs, kinds: undefined, racers: undefined } } };

function game(seed = 11, from = base) {
  const world = worldFor(from, seed);
  const state: GameState = syncWithContent(
    createGame({ seed, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }),
    world,
  );
  state.knownServers = world.servers.map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, world);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  return { state, world, act, ok };
}

describe('generated companies', () => {
  it('makes the configured number, each with its own name, id and address', () => {
    const made = generateCompanies(companies, 1);
    expect(made).toHaveLength(companies.count);
    for (const key of ['id', 'name', 'address'] as const) expect(new Set(made.map((server) => server[key])).size).toBe(made.length);
  });

  it('makes the same companies for the same seed, and different ones for another', () => {
    expect(generateCompanies(companies, 5)).toEqual(generateCompanies(companies, 5));
    expect(generateCompanies(companies, 5).map((s) => s.name)).not.toEqual(generateCompanies(companies, 6).map((s) => s.name));
  });

  it('never reuses an address that is already taken', () => {
    const taken = generateCompanies(companies, 3).map((server) => server.address);
    const made = generateCompanies(companies, 3, taken);
    expect(made.some((server) => taken.includes(server.address))).toBe(false);
  });

  it('keeps every layer within reach of bought programs, gives an admin login, and fills every placeholder', () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const server of generateCompanies(companies, seed)) {
        const { password, proxy, firewall, monitor } = server.security;
        // A version 2 program from the Backroom reaches level 4, slowly; a monitor at 3 is the most a generated company runs.
        expect(Math.max(password, proxy, firewall)).toBeLessThanOrEqual(4);
        expect(monitor).toBeLessThanOrEqual(3);
        expect(server.accounts.some((account) => account.role === 'admin')).toBe(true);
        expect(server.generated!.tier).toBeGreaterThanOrEqual(1);
        expect(server.generated!.tier).toBeLessThanOrEqual(5);
        const text = JSON.stringify([server.name, server.banner, server.files, server.logs, server.records]);
        expect(text, server.id).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('spreads across tiers', () => {
    const tiers = new Set(Array.from({ length: 10 }, (_, seed) => generateCompanies(companies, seed).map((s) => s.generated!.tier)).flat());
    expect([...tiers].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('are part of the game world, listed, with text files that open', () => {
    const h = game();
    const made = h.world.servers.filter((server) => server.generated);
    expect(made).toHaveLength(companies.count);
    expect(made.every((server) => server.listed && h.state.servers[server.id])).toBe(true);
    const withText = made.find((server) => server.files.some((file) => file.content));
    const file = withText!.files.find((item) => item.content)!;
    expect(fileContent(h.world, withText!.id, file.name)?.kind).toBe('text');
  });

  it('some hold module installers and program files, one grade better in the better-defended ones, and the board never asks for them', () => {
    let installers = 0;
    let programs = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const server of generateCompanies(companies, seed)) {
        for (const file of server.files) {
          const parts = file.part ? [file.part] : (file.program?.modules ?? []);
          if (file.part) installers++;
          if (file.program) programs++;
          for (const part of parts) {
            expect(part.grade).toBeGreaterThanOrEqual(1);
            expect(part.grade).toBeLessThanOrEqual(3);
          }
          if (file.part && server.generated!.tier >= 4) {
            const written = companies.sectors.find((sector) => sector.id === server.generated!.sector)!.installers!.find((item) => item.name === file.name)!;
            expect(file.part.grade).toBe(Math.min(3, written.part!.grade + 1));
          }
        }
      }
    }
    expect(installers).toBeGreaterThan(10);
    expect(programs).toBeGreaterThan(10);
    const h = game();
    h.state.player.rating = 8;
    for (let day = 0; day < 6; day++) {
      h.state.clock.gameTimeMs += 3 * 86_400_000;
      postJobs(h.state, h.world);
      for (const job of h.state.contracts.jobs) {
        if (job.objective.kind !== 'steal' && job.objective.kind !== 'destroy') continue;
        const wanted = job.objective.file;
        const file = h.world.servers.find((server) => server.id === job.targetId)!.files.find((item) => item.name === wanted)!;
        expect(file.part ?? file.program).toBeUndefined();
      }
    }
  });

  it('never ask for the same file twice on one board', () => {
    const h = game();
    h.state.player.rating = 60;
    for (let day = 0; day < 40; day++) {
      h.state.clock.gameTimeMs += 3 * 86_400_000;
      postJobs(h.state, h.world);
      const names = h.state.contracts.jobs.flatMap((job) =>
        [job.objective, ...(job.stages ?? []).map((stage) => stage.objective)].flatMap((objective) => (objective.kind === 'steal' ? [objective.file] : [])),
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('are placed in a region of the world', () => {
    expect(regionOf({ lat: 40, lon: -74 })).toBe('Americas');
    expect(regionOf({ lat: 52, lon: 4 })).toBe('Europe');
    expect(regionOf({ lat: 5, lon: -0.2 })).toBe('Africa & Middle East');
    expect(regionOf({ lat: 31, lon: 36 })).toBe('Africa & Middle East');
    expect(regionOf({ lat: 35, lon: 135 })).toBe('Asia & Pacific');
  });
});

describe('repeatable jobs', () => {
  it('the board keeps its number of jobs posted, against companies of about the right tier', () => {
    const h = game();
    postJobs(h.state, h.world);
    expect(h.state.contracts.jobs).toHaveLength(base.rules.boardJobs);
    for (const job of h.state.contracts.jobs) {
      const tier = h.world.servers.find((server) => server.id === job.targetId)!.generated!.tier;
      expect(tier).toBeLessThanOrEqual(tierForRating(0, base.rules.tierRatings));
      expect(job.summary).not.toMatch(/\{\w+\}/);
      expect(job.brief).not.toMatch(/\{\w+\}/);
    }
    // No two jobs touch the same company, counting every server a staged job visits.
    const touched = h.state.contracts.jobs.flatMap((job) => [job.targetId, ...(job.stages ?? []).map((stage) => stage.targetId)]);
    expect(new Set(touched).size).toBe(touched.length);
  });

  it('offers harder companies as the rating goes up', () => {
    const h = game();
    h.state.player.rating = 8;
    postJobs(h.state, h.world);
    const mainTarget = (job: (typeof h.state.contracts.jobs)[number]) => (job.stages && job.stages.length > 0 ? job.stages[job.stages.length - 1]!.targetId : job.targetId);
    const tiers = h.state.contracts.jobs.map((job) => h.world.servers.find((server) => server.id === mainTarget(job))!.generated!.tier);
    expect(tiers.every((tier) => tier >= 4)).toBe(true);
  });

  it('are on the board next to the hand-written contracts', () => {
    const h = game();
    postJobs(h.state, h.world);
    const offers = availableContracts(h.state, h.world);
    expect(offers.filter(isJob)).toHaveLength(base.rules.boardJobs);
    expect(offers.some((offer) => !isJob(offer))).toBe(true);
  });

  it('are all the board offers while lying low', () => {
    const h = game();
    postJobs(h.state, h.world);
    h.state.player.lieLowUntilMs = h.state.clock.gameTimeMs + 3_600_000;
    const offers = availableContracts(h.state, h.world);
    expect(offers).toHaveLength(base.rules.boardJobs);
    expect(offers.every(isJob)).toBe(true);
  });

  it('come off the board when they run out, and new ones go up', () => {
    const h = game();
    postJobs(h.state, h.world);
    const first = h.state.contracts.jobs.map((job) => job.id);
    h.state.clock.gameTimeMs += (base.rules.jobHours + 1) * 3_600_000;
    tick(h.state, 1000, h.world);
    expect(h.state.contracts.jobs).toHaveLength(base.rules.boardJobs);
    expect(h.state.contracts.jobs.some((job) => first.includes(job.id))).toBe(false);
  });

  it('can be taken, done and delivered like any contract, and are replaced', () => {
    const h = game(11, plainBase);
    postJobs(h.state, h.world);
    const job = h.state.contracts.jobs.find((item) => item.objective.kind === 'destroy') ?? h.state.contracts.jobs[0]!;
    h.ok({ type: 'connect', serverId: 'hidden' });
    const board = h.state.connections[0]!.id;
    h.ok({ type: 'login', connectionId: board, user: 'member' });
    h.ok({ type: 'acceptContract', connectionId: board, contractId: job.id });
    // A job being worked on is never taken down, even when its time is up.
    h.state.clock.gameTimeMs += (base.rules.jobHours + 1) * 3_600_000;
    postJobs(h.state, h.world);
    expect(h.state.contracts.jobs.some((item) => item.id === job.id)).toBe(true);
    // Do the job by hand.
    const target = h.state.servers[job.targetId]!;
    const goal = job.objective;
    if (goal.kind === 'destroy') target.files = target.files.filter((file) => file.name !== goal.file);
    else if (goal.kind === 'steal') h.state.player.files.push({ name: goal.file, sizeGq: 1, from: job.targetId });
    else if (goal.kind === 'record') target.records.find((row) => row[0] === goal.key)![1] = goal.value;
    const before = h.state.player.balance;
    h.ok({ type: 'deliverContract' });
    expect(h.state.player.balance).toBe(before + job.pay);
    expect(h.state.contracts.jobs.some((item) => item.id === job.id)).toBe(false);
    expect(h.state.contracts.jobs).toHaveLength(base.rules.boardJobs);
  });

  it('a job given up comes off the board', () => {
    const h = game();
    postJobs(h.state, h.world);
    const job = h.state.contracts.jobs[0]!;
    h.ok({ type: 'connect', serverId: 'hidden' });
    const board = h.state.connections[0]!.id;
    h.ok({ type: 'login', connectionId: board, user: 'member' });
    h.ok({ type: 'acceptContract', connectionId: board, contractId: job.id });
    h.ok({ type: 'abandonContract' });
    expect(h.state.contracts.jobs.some((item) => item.id === job.id)).toBe(false);
  });

  it('survive a save, and an active job keeps working after loading', () => {
    const h = game();
    postJobs(h.state, h.world);
    h.state.contracts.activeId = h.state.contracts.jobs[0]!.id;
    const loaded = syncWithContent(deserializeGame(serializeGame(h.state, 'now')).state, worldFor(base, h.state.seed));
    expect(loaded.contracts.jobs).toEqual(h.state.contracts.jobs);
    expect(loaded.contracts.activeId).toBe(h.state.contracts.jobs[0]!.id);
  });

  it('old saves (version 9) load with no jobs and get some on the next minute', () => {
    const h = game();
    const file = JSON.parse(serializeGame(h.state, 'now'));
    file.version = 9;
    file.state.version = 9;
    delete file.state.contracts.jobs;
    const loaded = syncWithContent(deserializeGame(JSON.stringify(file)).state, h.world);
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.contracts.jobs).toEqual([]);
    tick(loaded, 1000, h.world);
    expect(loaded.contracts.jobs).toHaveLength(base.rules.boardJobs);
  });
});

describe('the rating ladder', () => {
  it('moves up a tier each time the rating reaches the next mark', () => {
    const marks = [0, 2, 5, 9, 15];
    expect([0, 1, 2, 4, 5, 8, 9, 14, 15, 99].map((rating) => tierForRating(rating, marks))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('a delivered job earns the rating set for its company tier', () => {
    const h = game();
    postJobs(h.state, h.world);
    for (const job of h.state.contracts.jobs) {
      const tier = h.world.servers.find((server) => server.id === job.targetId)!.generated!.tier;
      expect(job.rating).toBe(base.rules.jobRatings[tier - 1]);
    }
  });

  it('a job saved before the ladder was stretched keeps the rating it was posted with', () => {
    const h = game();
    postJobs(h.state, h.world);
    h.state.contracts.jobs[0] = { ...h.state.contracts.jobs[0]!, rating: 1 };
    const loaded = syncWithContent(deserializeGame(serializeGame(h.state, 'now')).state, h.world);
    expect(loaded.contracts.jobs[0]!.rating).toBe(1);
  });

  it('the fixer writes about standing jobs once enough is delivered, and about linked servers at the set rating, each once', () => {
    const h = game();
    const world = { ...base, rules: { ...base.rules, jobsAfter: 1 } };
    h.state.contracts.completed = ['a'];
    noteProgress(h.state, world);
    noteProgress(h.state, world);
    expect(h.state.messages.filter((m) => m.subject === 'jobs')).toHaveLength(1);
    expect(h.state.messages.some((m) => m.subject === 'links')).toBe(false);
    h.state.player.rating = base.rules.linksAfterRating;
    noteProgress(h.state, world);
    noteProgress(h.state, world);
    expect(h.state.messages.filter((m) => m.subject === 'links')).toHaveLength(1);
  });
});
