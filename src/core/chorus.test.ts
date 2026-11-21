import { describe, expect, it } from 'vitest';
import { advanceChorus, chorusTargets, freeServer, isTaken, noteStoryJob, storyQuietMs, takeServer } from './chorus';
import { advanceStory } from './story';
import { beginRaid, holdOffMs, pullPlug, advanceRaid } from './raid';
import { createGame, deserializeGame, serializeGame, STATE_VERSION, syncWithContent, type Content, type GameState } from './index';
import { serverMark } from './news';
import { content as base, testServers } from './testWorld';
import { chorus as chorusDef, patrons } from '../content/index';
import { CHORUS_ID, type ChorusDef } from '../content/chorus';
import { storyOf, type StoryLine } from '../content/story';
import type { ContractDef } from '../content/schema';

const HOUR = 3_600_000;

function world(chorus: Partial<ChorusDef> = {}, lines?: StoryLine[], contracts: ContractDef[] = []): Content {
  return {
    ...base,
    servers: [...testServers],
    contracts: [...base.contracts, ...contracts],
    patrons,
    chorus: { ...chorusDef, protected: [], raidEvery: 0, ...chorus },
    ...(lines ? { story: storyOf(lines) } : {}),
  };
}

function game(content: Content): GameState {
  return syncWithContent(createGame({ seed: 9, handle: 'Ghost', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }), content);
}

function wake(state: GameState, content: Content): void {
  state.flags.push(content.chorus!.awakeFlag);
  advanceChorus(state, content);
}

const pass = (state: GameState, hours: number) => {
  state.clock.gameTimeMs += hours * HOUR;
};

describe('Chorus spreading', () => {
  it('sleeps until the story wakes it', () => {
    const content = world();
    const h = game(content);
    pass(h, 500);
    advanceChorus(h, content);
    expect(h.chorus.taken).toEqual([]);
    expect(h.chorus.nextMs).toBe(0);
  });

  it('takes one server every so often once awake, and the world notices', () => {
    const content = world({ spreadHours: 10 });
    const h = game(content);
    wake(h, content);
    expect(h.chorus.taken).toEqual([]);
    pass(h, 10);
    advanceChorus(h, content);
    expect(h.chorus.taken).toHaveLength(1);
    const id = h.chorus.taken[0]!;
    expect(content.servers.find((server) => server.id === id)?.kind).toBe('company');
    expect(serverMark(h, id)).toBe(content.chorus!.label);
    // A polite note, with the player's handle on it.
    const note = h.servers[id]!.files.find((file) => file.name === 'for_Ghost.txt');
    expect(note?.text).toContain('Ghost');
    // The Wire misreads it.
    expect(h.news.pending.some((item) => item.serverId === id && item.kind === 'world')).toBe(true);
    pass(h, 10);
    advanceChorus(h, content);
    expect(h.chorus.taken).toHaveLength(2);
  });

  it('goes for servers the player knows first, and never the story\'s own, a protected one or one the player is on', () => {
    const story: ContractDef = { ...base.contracts[0]!, id: 'story-x', targetId: 'vault', story: true };
    const content = world({ protected: ['tower'] }, undefined, [story]);
    const h = game(content);
    h.connections.push({ ...({} as GameState['connections'][number]), id: 'c1', serverId: 'desk' } as GameState['connections'][number]);
    const targets = chorusTargets(h, content);
    expect(targets).not.toContain('vault');
    expect(targets).not.toContain('tower');
    expect(targets).not.toContain('desk');
    expect(targets).toContain('corp');
    h.connections = [];
    h.knownServers.push('fort');
    wake(h, content);
    pass(h, content.chorus!.spreadHours);
    advanceChorus(h, content);
    expect(h.chorus.taken).toEqual(['fort']);
  });

  it('spreads faster after a long quiet, and a story job for the Office sets it back', () => {
    const content = world({ spreadHours: 20, quietDays: 2, quietPace: 2, pushbackHours: 15 });
    const h = game(content);
    wake(h, content);
    const first = h.chorus.nextMs;
    expect(first - h.clock.gameTimeMs).toBe(20 * HOUR);
    noteStoryJob(h, content, 'office');
    expect(h.chorus.nextMs).toBe(first + 15 * HOUR);
    noteStoryJob(h, content, 'calder');
    expect(h.chorus.nextMs).toBe(first + 15 * HOUR);
    // Two quiet days: from then on it comes every ten hours.
    pass(h, 49);
    expect(storyQuietMs(h)).toBe(49 * HOUR);
    advanceChorus(h, content);
    const taken = h.chorus.taken.length;
    expect(h.chorus.nextMs - h.clock.gameTimeMs).toBeLessThanOrEqual(10 * HOUR);
    pass(h, 10);
    advanceChorus(h, content);
    expect(h.chorus.taken.length).toBe(taken + 1);
  });

  it('takes only a few at once after a long gap', () => {
    const content = world({ spreadHours: 1 });
    const h = game(content);
    wake(h, content);
    pass(h, 100);
    advanceChorus(h, content);
    expect(h.chorus.taken.length).toBeLessThanOrEqual(5);
    expect(h.chorus.nextMs).toBeGreaterThan(h.clock.gameTimeMs);
  });

  it('tidies the player out of a taken server once they have left, but keeps a line they planted', () => {
    const content = world();
    const h = game(content);
    wake(h, content);
    takeServer(h, content, 'corp');
    const logs = h.servers['corp']!.logs;
    logs.push({ id: 900, timeMs: 1, text: 'login admin from 10.0.0.1', byPlayer: true });
    logs.push({ id: 901, timeMs: 2, text: 'login ops from 10.9.9.9', byPlayer: true, framed: 'someone' });
    h.connections.push({ id: 'c1', serverId: 'corp' } as GameState['connections'][number]);
    advanceChorus(h, content);
    expect(h.servers['corp']!.logs.some((entry) => entry.id === 900)).toBe(true);
    h.connections = [];
    advanceChorus(h, content);
    const after = h.servers['corp']!.logs;
    expect(after.some((entry) => entry.id === 900)).toBe(false);
    expect(after.some((entry) => entry.id === 901)).toBe(true);
    expect(after.some((entry) => entry.text === content.chorus!.tidyLine)).toBe(true);
  });

  it('lets the story take and free servers by name', () => {
    const sc: ContractDef = { ...base.contracts[0]!, id: 'sc-lock', story: true, patron: 'office' };
    const content = world({}, [
      {
        id: 'main',
        beats: [
          { id: 'wake', set: ['chorus-awake'], take: ['tower'] },
          { id: 'lock', contractId: 'sc-lock', free: ['tower'], chorus: 5, mail: { from: 'Office', subject: 'lock', body: 'b' }, lapse: { hours: 48, take: ['fort'] } },
        ],
      },
    ], [sc]);
    const h = game(content);
    advanceStory(h, content);
    advanceChorus(h, content);
    expect(isTaken(h, 'tower')).toBe(true);
    const next = h.chorus.nextMs;
    pass(h, 49);
    advanceStory(h, content);
    expect(isTaken(h, 'fort')).toBe(true);
    h.contracts.completed.push('sc-lock');
    advanceStory(h, content);
    expect(isTaken(h, 'tower')).toBe(false);
    expect(serverMark(h, 'tower')).toBeUndefined();
    expect(h.servers['tower']!.files.some((file) => file.name === 'for_Ghost.txt')).toBe(false);
    // An Office job plus the beat's own five hours.
    expect(h.chorus.nextMs).toBe(next + (content.chorus!.pushbackHours + 5) * HOUR);
    expect(h.chorus.lastStoryMs).toBe(h.clock.gameTimeMs);
  });

  it('frees nothing it never took', () => {
    const content = world();
    const h = game(content);
    freeServer(h, content, 'corp');
    expect(h.chorus.taken).toEqual([]);
  });
});

describe('Chorus at the gateway', () => {
  it('comes to the gateway every few servers taken', () => {
    const content = world({ raidEvery: 2 });
    const h = game(content);
    takeServer(h, content, 'corp');
    expect(h.raidPending).toBeNull();
    takeServer(h, content, 'tower');
    expect(h.raidPending).toEqual({ attackerId: CHORUS_ID, story: false });
  });

  it('cannot be traced, and gives up if held off long enough', () => {
    const content = world();
    const h = game(content);
    expect(beginRaid(h, content, CHORUS_ID)).toBe(true);
    expect(h.messages.at(-1)!.subject).toBe(content.chorus!.letters.raid.subject);
    expect(h.raid!.route).toEqual([]);
    // Make the break-in slow enough to outlast.
    (h.raid as { breachTotalMs: number }).breachTotalMs = 10_000_000;
    const hold = holdOffMs(h, content)!;
    expect(hold).toBe(content.chorus!.rival.holdSeconds * 1000);
    h.clock.gameTimeMs += hold;
    advanceRaid(h, content, 1000);
    expect(h.raid).toBeNull();
    expect(h.messages.at(-1)!.subject).toBe(content.chorus!.letters.held.subject);
  });

  it('refuses a trace back', async () => {
    const content = world();
    const h = game(content);
    beginRaid(h, content, CHORUS_ID);
    const { startRaidTrace } = await import('./raid');
    expect(startRaidTrace(h, content)).toMatch(/nobody/);
  });

  it('breaking in, it takes the file it is after first', () => {
    const content = world({ rival: { ...chorusDef.rival, targets: ['ledger.mdl'] } });
    const h = game(content);
    h.player.files.push({ name: 'other.dat', sizeGq: 1, from: 'corp' }, { name: 'ledger.mdl', sizeGq: 1, from: 'vault' });
    beginRaid(h, content, CHORUS_ID);
    advanceRaid(h, content, h.raid!.breachTotalMs + 1);
    expect(h.player.files.map((file) => file.name)).toEqual(['other.dat']);
    expect(h.messages.at(-1)!.body).toContain('ledger.mdl');
  });

  it('pulling the plug sends its own letter', () => {
    const content = world();
    const h = game(content);
    beginRaid(h, content, CHORUS_ID);
    expect(pullPlug(h, content)).toBeNull();
    expect(h.messages.at(-1)!.subject).toBe(content.chorus!.letters.fled.subject);
  });
});

describe('Chorus in saves', () => {
  it('starts asleep in an old save and round-trips', () => {
    const content = world();
    const h = game(content);
    const file = JSON.parse(serializeGame(h, '2030-01-01T00:00:00Z'));
    file.version = 28;
    file.state.version = 28;
    delete file.state.chorus;
    const loaded = deserializeGame(JSON.stringify(file)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.chorus).toEqual({ taken: [], nextMs: 0, takes: 0, lastStoryMs: 0 });
    wake(h, content);
    takeServer(h, content, 'corp');
    expect(deserializeGame(serializeGame(h, '2030-01-01T00:00:00Z')).state.chorus).toEqual(h.chorus);
  });
});
