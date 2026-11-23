import { describe, expect, it } from 'vitest';
import { advanceStory, aiTrust, beatPassed, beatsSeen, currentBeat, storyComplete, storyOffered, storyWaits } from './story';
import { readFile } from './phish';
import { availableContracts, createGame, deserializeGame, serializeGame, STATE_VERSION, syncWithContent, type Content, type GameState } from './index';
import { content as base, testServers } from './testWorld';
import { parseStory, storyOf, checkStory, type StoryLine } from '../content/story';
import { patrons } from '../content/index';
import type { ContractDef } from '../content/schema';

const mail = (id: string) => ({ from: 'Vesper', subject: id, body: `b-${id}` });

const storyContracts: ContractDef[] = ['sc-a', 'sc-b', 'sc-c', 'sc-undo'].map((id) => ({
  id,
  title: id,
  client: 'Vesper',
  targetId: 'corp',
  pay: 100,
  rating: 1,
  minRating: 0,
  story: true,
  summary: id,
  brief: id,
  objective: { kind: 'steal', file: 'secret.dat' },
  ...(id === 'sc-c' ? { choices: [{ id: 'keep', label: 'Keep it', note: 'n', pay: 0, rating: 0, keep: true }] } : {}),
}));

function world(lines: StoryLine[]): Content {
  return { ...base, servers: [...testServers], contracts: [...base.contracts, ...storyContracts], patrons, story: storyOf(lines) };
}

function game(content: Content, rating = 0): GameState {
  const state = syncWithContent(createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }), content);
  state.player.rating = rating;
  return state;
}

const pass = (state: GameState, hours: number) => {
  state.clock.gameTimeMs += hours * 3_600_000;
};
const subjects = (state: GameState) => state.messages.filter((m) => m.from === 'Vesper').map((m) => m.subject);

describe('Story lines', () => {
  it('runs lines side by side, each on its own clock', () => {
    const content = world([
      { id: 'main', beats: [{ id: 'm1', mail: mail('m1') }, { id: 'm2', afterHours: 10, mail: mail('m2') }] },
      { id: 'office', beats: [{ id: 'o1', contractId: 'sc-a', mail: mail('o1') }, { id: 'o2', mail: mail('o2') }] },
      { id: 'daylight', beats: [{ id: 'd1', afterHours: 2, mail: mail('d1') }] },
    ]);
    const h = game(content);
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['m1', 'o1']);
    expect(storyOffered(h)).toEqual(['sc-a']);
    pass(h, 3);
    advanceStory(h, content);
    // Daylight's line moved on while the Office's waits on its job and the main line on its spacing.
    expect(subjects(h)).toEqual(['m1', 'o1', 'd1']);
    h.contracts.completed.push('sc-a');
    advanceStory(h, content);
    expect(subjects(h)).toContain('o2');
    expect(beatPassed(h, 'o1')).toBe(true);
    expect(storyComplete(h, content)).toBe(false);
    pass(h, 8);
    advanceStory(h, content);
    expect(storyComplete(h, content)).toBe(true);
    expect(beatsSeen(h, content)).toEqual(['m1', 'm2', 'o1', 'o2', 'd1']);
  });

  it('opens a line only when its condition holds, and times its first beat from then', () => {
    const content = world([
      { id: 'main', beats: [{ id: 'act2-end', contractId: 'sc-a', mail: mail('act2-end') }] },
      { id: 'act3', when: { flags: ['story:act2-end'] }, beats: [{ id: 'three-ways', afterHours: 2, mail: mail('three-ways') }] },
    ]);
    const h = game(content);
    advanceStory(h, content);
    expect(h.story.lines['act3']).toBeUndefined();
    // Nothing is waiting that could happen, but the act is not over: the job is still out.
    expect(storyComplete(h, content)).toBe(false);
    pass(h, 50);
    h.contracts.completed.push('sc-a');
    advanceStory(h, content);
    expect(h.story.lines['act3']).toBeDefined();
    expect(subjects(h)).not.toContain('three-ways');
    pass(h, 2);
    advanceStory(h, content);
    expect(subjects(h)).toContain('three-ways');
  });

  it('holds a beat on its condition, and skips one whose "if" fails', () => {
    const content = world([
      {
        id: 'main',
        beats: [
          { id: 'job', contractId: 'sc-c', mail: mail('job') },
          { id: 'kept', if: { choices: { 'sc-c': 'keep' } }, mail: mail('kept') },
          { id: 'gave', if: { choices: { 'sc-c': 'default' } }, mail: mail('gave') },
          { id: 'waits', when: { flags: ['wren-found'] }, mail: mail('waits') },
        ],
      },
    ]);
    const h = game(content);
    advanceStory(h, content);
    h.contracts.completed.push('sc-c');
    h.patrons.choices['sc-c'] = 'keep';
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['job', 'kept']);
    // The skipped beat sets no flag.
    expect(beatPassed(h, 'gave')).toBe(false);
    expect(currentBeat(h, content)?.id).toBe('waits');
    h.flags.push('wren-found');
    advanceStory(h, content);
    expect(subjects(h)).toContain('waits');
  });

  it('sets and clears flags, and moves the hidden AI trust', () => {
    const content = world([
      {
        id: 'main',
        beats: [
          { id: 'found', set: ['wren-found', 'station-taken'], standing: { ais: 3 }, mail: mail('found') },
          { id: 'saved', clear: ['station-taken'], standing: { ais: -1 }, mail: mail('saved') },
        ],
      },
    ]);
    const h = game(content);
    advanceStory(h, content);
    expect(h.flags).toContain('wren-found');
    expect(h.flags).not.toContain('station-taken');
    expect(aiTrust(h)).toBe(2);
    // Hidden: it sends no standing letter and the patron is never met.
    expect(h.patrons.met).not.toContain('ais');
    expect(h.messages.filter((m) => m.from !== 'Vesper' && m.from !== 'Fixer')).toHaveLength(0);
  });

  it('fires a timed turn once when a line is left alone, and the undo job clears it', () => {
    const content = world([
      {
        id: 'wick',
        beats: [
          { id: 'clerk', contractId: 'sc-a', mail: mail('clerk'), lapse: { hours: 24, set: ['station-taken'], mail: mail('taken'), withdraw: true } },
          { id: 'dead-air', if: { flags: ['station-taken'] }, contractId: 'sc-undo', clear: ['station-taken'], set: ['station-recovered'], mail: mail('dead-air') },
          { id: 'after', mail: mail('after') },
        ],
      },
    ]);
    const h = game(content);
    advanceStory(h, content);
    pass(h, 23);
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['clerk']);
    pass(h, 2);
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['clerk', 'taken', 'dead-air']);
    expect(h.flags).toContain('station-taken');
    // The ignored job is gone from the board, and its beat never passed.
    expect(storyOffered(h)).toEqual(['sc-undo']);
    expect(availableContracts(h, content).map((c) => c.id)).not.toContain('sc-a');
    expect(beatPassed(h, 'clerk')).toBe(false);
    h.contracts.completed.push('sc-undo');
    advanceStory(h, content);
    expect(h.flags).not.toContain('station-taken');
    expect(h.flags).toContain('station-recovered');
    expect(subjects(h)).toContain('after');
  });

  it('skips the undo when the job was done in time', () => {
    const content = world([
      {
        id: 'wick',
        beats: [
          { id: 'clerk', contractId: 'sc-a', mail: mail('clerk'), lapse: { hours: 24, set: ['station-taken'], withdraw: true } },
          { id: 'dead-air', if: { flags: ['station-taken'] }, contractId: 'sc-undo', mail: mail('dead-air') },
        ],
      },
    ]);
    const h = game(content);
    advanceStory(h, content);
    h.contracts.completed.push('sc-a');
    pass(h, 30);
    advanceStory(h, content);
    expect(h.flags).not.toContain('station-taken');
    expect(subjects(h)).toEqual(['clerk']);
    expect(storyComplete(h, content)).toBe(true);
  });

  it('never withdraws the job the player is working on; the turn waits', () => {
    const content = world([
      { id: 'main', beats: [{ id: 'clerk', contractId: 'sc-a', mail: mail('clerk'), lapse: { hours: 1, set: ['late'], withdraw: true } }, { id: 'next', mail: mail('next') }] },
    ]);
    const h = game(content);
    advanceStory(h, content);
    h.contracts.activeId = 'sc-a';
    pass(h, 2);
    advanceStory(h, content);
    advanceStory(h, content);
    expect(h.flags).toContain('late');
    expect(storyOffered(h)).toContain('sc-a');
    // Finished after all: it passes the usual way.
    h.contracts.activeId = null;
    h.contracts.completed.push('sc-a');
    advanceStory(h, content);
    expect(beatPassed(h, 'clerk')).toBe(true);
    expect(subjects(h).filter((s) => s === 'next')).toHaveLength(1);
  });

  it('a lapse without withdraw keeps the job up and fires only once', () => {
    const content = world([{ id: 'main', beats: [{ id: 'slow', contractId: 'sc-a', mail: mail('slow'), lapse: { hours: 1, mail: mail('nudge') } }] }]);
    const h = game(content);
    advanceStory(h, content);
    pass(h, 2);
    advanceStory(h, content);
    pass(h, 20);
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['slow', 'nudge']);
    expect(storyOffered(h)).toContain('sc-a');
  });
});

describe('Story lines in saves', () => {
  it('moves a save from before lines onto the main line, exactly where it was, and fills in passed beats', () => {
    const content = world([
      { id: 'main', beats: [{ id: 'b0', mail: mail('b0') }, { id: 'b1', mail: mail('b1') }, { id: 'b2', contractId: 'sc-a', mail: mail('b2') }] },
    ]);
    const state = game(content);
    const file = JSON.parse(serializeGame(state, '2030-01-01T00:00:00Z'));
    file.version = 27;
    file.state.version = 27;
    file.state.story = { beat: 2, arrived: true, lastMs: 1234, offered: ['sc-a'] };
    const loaded = syncWithContent(deserializeGame(JSON.stringify(file)).state, content);
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.story).toEqual({ lines: { main: { beat: 2, arrived: true, lastMs: 1234, id: 'b2' } }, offered: ['sc-a'] });
    expect(beatPassed(loaded, 'b0')).toBe(true);
    expect(beatPassed(loaded, 'b1')).toBe(true);
    expect(beatPassed(loaded, 'b2')).toBe(false);
    // And it carries on from there without sending anything twice.
    advanceStory(loaded, content);
    expect(subjects(loaded)).toHaveLength(0);
    loaded.contracts.completed.push('sc-a');
    advanceStory(loaded, content);
    expect(storyComplete(loaded, content)).toBe(true);
  });

  it('round-trips lines and a fired lapse through a save', () => {
    const content = world([{ id: 'main', beats: [{ id: 'slow', contractId: 'sc-a', mail: mail('slow'), lapse: { hours: 1, mail: mail('nudge') } }] }]);
    const h = game(content);
    advanceStory(h, content);
    pass(h, 2);
    advanceStory(h, content);
    const loaded = deserializeGame(serializeGame(h, '2030-01-01T00:00:00Z')).state;
    expect(loaded.story).toEqual(h.story);
    advanceStory(loaded, content);
    expect(subjects(loaded)).toEqual(['slow', 'nudge']);
  });
});

describe('Story file', () => {
  it('reads a bare beats list as the main line', () => {
    const story = parseStory({ beats: [{ id: 'a', mail: mail('a') }] });
    expect(story.lines?.map((line) => line.id)).toEqual(['main']);
    expect(story.beats.map((beat) => beat.id)).toEqual(['a']);
  });

  it('refuses mistakes', () => {
    expect(() => parseStory({ lines: [{ id: 'x', beats: [{ id: 'a', mail: mail('a') }] }] })).toThrow(/main/);
    expect(() => parseStory({ lines: [{ id: 'main', beats: [{ id: 'a', mail: mail('a') }] }, { id: 'o', beats: [{ id: 'a', mail: mail('a') }] }] })).toThrow(/twice/);
    expect(() => parseStory({ beats: [{ id: 'a', mail: mail('a'), lapse: { hours: 2, set: ['x'] } }] })).toThrow(/only a beat with a contract/);
    expect(() => parseStory({ beats: [{ id: 'a', mail: mail('a'), soon: true }] })).toThrow(/unknown part/);
    expect(() => parseStory({ beats: [{ id: 'a', when: { mood: 1 }, mail: mail('a') }] })).toThrow(/unknown part/);
    const story = parseStory({ beats: [{ id: 'a', when: { flags: ['story:nope'] }, mail: mail('a') }] });
    expect(() => checkStory(story, testServers, storyContracts, [], ['ais'])).toThrow(/does not exist/);
    const wrongPatron = parseStory({ beats: [{ id: 'a', standing: { nobody: 1 } }] });
    expect(() => checkStory(wrongPatron, testServers, storyContracts, [], ['ais'])).toThrow(/not a patron/);
    const twice = parseStory({ lines: [{ id: 'main', beats: [{ id: 'a', contractId: 'sc-a' }] }, { id: 'o', beats: [{ id: 'b', contractId: 'sc-a' }] }] });
    expect(() => checkStory(twice, testServers, storyContracts, [], ['ais'])).toThrow(/already offered/);
  });
});

describe('Leads, needs and beats remembered by id', () => {
  it('lets a player who read the clue get the next beat sooner, and leaves the rest at the usual rating', () => {
    const content = world([
      { id: 'main', beats: [{ id: 'early', minRating: 20, lead: { when: { read: ['corp/secret.dat'] }, minRating: 5 }, mail: mail('early') }] },
    ]);
    const curious = game(content, 6);
    const busy = game(content, 6);
    advanceStory(busy, content);
    expect(subjects(busy)).toEqual([]);
    // A file nobody asks about is not remembered; the clue is.
    curious.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'corp' });
    expect(readFile(curious, content, 'corp', 'secret.dat')).toBe(null);
    expect(curious.flags).toContain('read:corp/secret.dat');
    expect(readFile(curious, content, 'corp', 'nothing.dat')).not.toBe(null);
    advanceStory(curious, content);
    expect(subjects(curious)).toEqual(['early']);
    busy.player.rating = 20;
    advanceStory(busy, content);
    expect(subjects(busy)).toEqual(['early']);
  });

  it('lowers a written contract the board offers for a player who followed its lead', () => {
    const lead: ContractDef = { ...storyContracts[0]!, id: 'board-lead', story: false, minRating: 30, lead: { when: { flags: ['seen-it'] }, minRating: 2 } };
    const content: Content = { ...world([{ id: 'main', beats: [{ id: 'm', mail: mail('m') }] }]), contracts: [...base.contracts, lead] };
    const state = game(content, 3);
    expect(availableContracts(state, content).some((contract) => contract.id === 'board-lead')).toBe(false);
    state.flags.push('seen-it');
    expect(availableContracts(state, content).some((contract) => contract.id === 'board-lead')).toBe(true);
  });

  it('holds a ready beat until the player has what it needs, says once what is missing, and lists it for the board', () => {
    const content = world([
      {
        id: 'main',
        beats: [
          {
            id: 'go',
            contractId: 'sc-a',
            mail: mail('go'),
            needs: [
              { note: 'The key from the Office', when: { flags: ['key'] } },
              { note: 'A name people know', rating: 10 },
            ],
            waitMail: { from: 'Vesper', subject: 'not yet', body: 'Missing:\n{needs}' },
          },
        ],
      },
    ]);
    const h = game(content, 4);
    advanceStory(h, content);
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['not yet']);
    expect(h.messages.at(-1)!.body).toBe('Missing:\n- The key from the Office\n- A name people know');
    expect(storyOffered(h)).toEqual([]);
    expect(storyWaits(h, content)).toEqual([{ lineId: 'main', beatId: 'go', needs: [{ note: 'The key from the Office', met: false }, { note: 'A name people know', met: false }] }]);
    h.flags.push('key');
    advanceStory(h, content);
    expect(storyWaits(h, content)[0]!.needs.map((need) => need.met)).toEqual([true, false]);
    expect(subjects(h)).toEqual(['not yet']);
    h.player.rating = 10;
    advanceStory(h, content);
    expect(subjects(h)).toEqual(['not yet', 'go']);
    expect(storyOffered(h)).toEqual(['sc-a']);
    expect(storyWaits(h, content)).toEqual([]);
  });

  it('keeps a save on its beat when new beats are written in ahead of it', () => {
    const before = world([{ id: 'main', beats: [{ id: 'a', mail: mail('a') }, { id: 'b', contractId: 'sc-a', mail: mail('b') }, { id: 'c', mail: mail('c') }] }]);
    const h = game(before);
    advanceStory(h, before);
    expect(h.story.lines.main).toMatchObject({ beat: 1, id: 'b', arrived: true });
    const after = world([
      { id: 'main', beats: [{ id: 'new1', mail: mail('new1') }, { id: 'a', mail: mail('a') }, { id: 'new2', mail: mail('new2') }, { id: 'b', contractId: 'sc-a', mail: mail('b') }, { id: 'c', mail: mail('c') }] },
    ]);
    const loaded = syncWithContent(deserializeGame(serializeGame(h, '2030-01-01T00:00:00Z')).state, after);
    expect(loaded.story.lines.main).toMatchObject({ beat: 3, id: 'b', arrived: true });
    loaded.contracts.completed.push('sc-a');
    advanceStory(loaded, after);
    // The new beats behind it are not sent; the line carries on after "b".
    expect(subjects(loaded)).toEqual(['a', 'b', 'c']);
  });

  it('checks leads and needs as it reads the story', () => {
    expect(() => parseStory({ lines: [{ id: 'main', beats: [{ id: 'x', mail: mail('x'), waitMail: mail('w') }] }] })).toThrow(/only a beat with needs/);
    expect(() => parseStory({ lines: [{ id: 'main', beats: [{ id: 'x', mail: mail('x'), needs: [{ note: 'n' }] }] }] })).toThrow(/must check something/);
    const low = world([{ id: 'main', beats: [{ id: 'x', minRating: 3, lead: { when: {}, minRating: 5 }, mail: mail('x') }] }]);
    expect(() => checkStory(low.story, low.servers, low.contracts, [])).toThrow(/must lower the rating gate/);
    const bad = world([{ id: 'main', beats: [{ id: 'x', lead: { when: { read: ['corp/nope.dat'] }, minRating: 0 }, minRating: 2, mail: mail('x') }] }]);
    expect(() => checkStory(bad.story, bad.servers, bad.contracts, [])).toThrow(/not a file on a server/);
    const heist = world([{ id: 'main', beats: [{ id: 'x', mail: mail('x'), needs: [{ note: 'n', linesFor: 'sc-a' }] }] }]);
    expect(() => checkStory(heist.story, heist.servers, heist.contracts, [])).toThrow(/not a heist contract/);
  });
});
