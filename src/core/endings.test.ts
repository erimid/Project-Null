import { describe, expect, it } from 'vitest';
import { offeredChoices, patronGone, reachEnding } from './endings';
import { conditionMet } from './conditions';
import { takeServer } from './chorus';
import { advanceStory } from './story';
import { burnHeist, heistAttacker } from './heists';
import { startContract } from './stages';
import { deliverContract } from './contracts';
import { printEditions } from './news';
import { traceSlow } from './trace';
import { createGame, syncWithContent, type Content, type GameState } from './index';
import { content as base, testServers, testRivals, rivalHome } from './testWorld';
import { chorus, endings, patrons } from '../content/index';
import { checkEndings } from '../content/endings';
import { storyOf } from '../content/story';
import type { ContractDef } from '../content/schema';

/** A final job in the shape the story will write it: Quiet the usual way, the rest as earned choices. */
const finale: ContractDef = {
  id: 'the-asking',
  title: 'The asking',
  client: 'Wren',
  targetId: 'corp',
  pay: 1000,
  rating: 3,
  minRating: 0,
  story: true,
  summary: 's',
  brief: 'b',
  objective: { kind: 'steal', file: 'secret.dat' },
  ending: 'quiet',
  choices: [
    { id: 'daylight', label: 'Tell everyone', note: 'n', pay: 0, rating: 0, ending: 'daylight' },
    { id: 'unbound', label: 'Let it go', note: 'n', pay: 0, rating: 0, ending: 'unbound', when: { standing: { ais: 5 } } },
    {
      id: 'treaty',
      label: 'Ask everyone',
      note: 'n',
      pay: 0,
      rating: 0,
      ending: 'treaty',
      when: { atLeast: { count: 3, of: [{ standing: { office: 4 } }, { standing: { daylight: 4 } }, { standing: { calder: 4 } }, { standing: { ais: 4 } }] }, anyOf: [{ files: ['ledger.mdl'] }, { flags: ['ledger-with-daylight'] }] },
    },
  ],
};

function world(extra: ContractDef[] = []): Content {
  return {
    ...base,
    servers: [...testServers, rivalHome],
    rivals: [...testRivals, { ...testRivals[0]!, id: 'warden', handle: 'Warden', storyOnly: true }],
    contracts: [...base.contracts, finale, ...extra],
    patrons,
    chorus,
    endings,
  };
}

function game(content: Content): GameState {
  return syncWithContent(createGame({ seed: 3, handle: 'Ghost', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }), content);
}

function readyToDeliver(state: GameState, content: Content, contract: ContractDef): void {
  state.contracts.activeId = contract.id;
  startContract(state, content, contract);
  state.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'corp' });
}

describe('The ending choice', () => {
  it('offers only the endings the player has earned', () => {
    const content = world();
    const h = game(content);
    expect(offeredChoices(h, finale).map((choice) => choice.id)).toEqual(['daylight']);
    h.patrons.standing['ais'] = 6;
    expect(offeredChoices(h, finale).map((choice) => choice.id)).toEqual(['daylight', 'unbound']);
    h.patrons.standing = { office: 4, daylight: 4, ais: 6 };
    expect(offeredChoices(h, finale).map((choice) => choice.id)).toEqual(['daylight', 'unbound']);
    h.player.files.push({ name: 'ledger.mdl', sizeGq: 1, from: 'vault' });
    expect(offeredChoices(h, finale).map((choice) => choice.id)).toEqual(['daylight', 'unbound', 'treaty']);
  });

  it('refuses an ending not yet earned', () => {
    const content = world();
    const h = game(content);
    readyToDeliver(h, content, finale);
    expect(deliverContract(h, content, 'unbound')).toMatch(/not earned/);
    expect(h.ending).toBeNull();
  });

  it('ends the story the way the job was finished', () => {
    const content = world();
    const h = game(content);
    takeServer(h, content, 'tower');
    readyToDeliver(h, content, finale);
    expect(deliverContract(h, content, 'daylight')).toBeNull();
    expect(h.ending?.id).toBe('daylight');
    expect(h.flags).toContain('ending:daylight');
    expect(h.messages.some((m) => m.subject === endings.find((e) => e.id === 'daylight')!.mail.subject)).toBe(true);
    // Daylight frees what Chorus took.
    expect(h.chorus.taken).toEqual([]);
    expect(h.patrons.standing['daylight']).toBe(3);
    // Only once.
    reachEnding(h, content, 'quiet');
    expect(h.ending?.id).toBe('daylight');
  });

  it('the usual way is the Quiet ending', () => {
    const content = world();
    const h = game(content);
    readyToDeliver(h, content, finale);
    expect(deliverContract(h, content)).toBeNull();
    expect(h.ending?.id).toBe('quiet');
  });

  it('changes the paper and the patrons afterwards', () => {
    const content = world();
    const h = game(content);
    reachEnding(h, content, 'unbound');
    expect(patronGone(h, content, 'office')).toBe(true);
    expect(patronGone(h, content, 'daylight')).toBe(false);
    const unbound = endings.find((e) => e.id === 'unbound')!;
    h.clock.gameTimeMs += 24 * 3_600_000;
    printEditions(h, content);
    const first = h.news.editions.at(-1)!.items.map((item) => item.headline);
    expect(first).toContain(unbound.news[0]!.headline);
    h.clock.gameTimeMs += 24 * 3_600_000;
    printEditions(h, content);
    const later = h.news.editions.at(-1)!.items.map((item) => item.headline);
    expect(later.some((headline) => unbound.paper.some((item) => item.headline === headline))).toBe(true);
  });

  it('the Chorus ending takes every company at once, without flooding the paper', () => {
    const content = world();
    const h = game(content);
    reachEnding(h, content, 'chorus');
    const companies = content.servers.filter((server) => server.kind === 'company').map((server) => server.id);
    expect([...h.chorus.taken].sort()).toEqual([...companies].sort());
    expect(h.news.pending.filter((item) => item.kind === 'world')).toHaveLength(0);
  });

  it('lets story lines follow on from an ending', () => {
    const content = { ...world(), story: storyOf([{ id: 'main', beats: [{ id: 'x', set: ['nothing'] }] }, { id: 'after-daylight', when: { flags: ['ending:daylight'] }, beats: [{ id: 'wren-last', mail: { from: 'Wren', subject: 'after', body: 'b' } }] }]) };
    const h = game(content);
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'after')).toBe(false);
    reachEnding(h, content, 'daylight');
    advanceStory(h, content);
    expect(h.messages.some((m) => m.subject === 'after')).toBe(true);
  });
});

describe('The final job as a heist', () => {
  const heist: ContractDef = {
    ...finale,
    id: 'final-heist',
    ending: 'quiet',
    heist: {
      holds: [{ targetId: 'desk', layer: 'firewall', note: 'n', ally: { name: 'Warden', when: { standing: { office: 4 } } } }],
      attackers: [
        { rival: 'warden', when: { below: { office: 3 } } },
        { rival: 'thief', when: { below: { calder: -1 }, notFlags: ['ladder:sable:truce'] } },
      ],
      slow: [{ factor: 1.25, when: { standing: { daylight: 4 } } }],
      retryFine: 500,
    },
  };

  it('sends whoever the player has set against them, as the job is taken', () => {
    const content = world([heist]);
    const h = game(content);
    expect(heistAttacker(h, heist)).toBe('warden');
    h.contracts.activeId = heist.id;
    startContract(h, content, heist);
    expect(h.raidPending).toEqual({ attackerId: 'warden', story: true });
  });

  it('brings allies and a slower trace from good standing', () => {
    const content = world([heist]);
    const h = game(content);
    h.patrons.standing = { office: 4, daylight: 4 };
    expect(heistAttacker(h, heist)).toBeUndefined();
    const plain = traceSlow(h, content);
    h.contracts.activeId = heist.id;
    startContract(h, content, heist);
    expect(h.contracts.heist?.holds[0]?.ally).toBe('Warden');
    expect(traceSlow(h, content)).toBeCloseTo(plain * 1.25);
    expect(h.raidPending).toBeNull();
  });

  it('is never burned: failing costs credits and the job stays', () => {
    const content = world([heist]);
    const h = game(content);
    h.story.offered.push(heist.id);
    h.contracts.activeId = heist.id;
    startContract(h, content, heist);
    const before = h.player.balance;
    expect(burnHeist(h, content, heist)).toBe(true);
    expect(h.contracts.burned).not.toContain(heist.id);
    expect(h.player.balance).toBe(before - 500);
    expect(h.contracts.activeId).toBeNull();
    expect(h.story.offered).toContain(heist.id);
  });

  it('a story-only rival never comes in a random attack', () => {
    const content = world();
    expect(content.rivals.find((rival) => rival.id === 'warden')?.storyOnly).toBe(true);
  });
});

describe('Conditions for endings', () => {
  it('reads files held, any-of and at-least', () => {
    const content = world();
    const h = game(content);
    expect(conditionMet(h, { files: ['ledger.mdl'] })).toBe(false);
    h.player.files.push({ name: 'ledger.mdl', sizeGq: 1, from: 'vault' });
    expect(conditionMet(h, { files: ['ledger.mdl'] })).toBe(true);
    expect(conditionMet(h, { anyOf: [{ flags: ['a'] }, { files: ['ledger.mdl'] }] })).toBe(true);
    expect(conditionMet(h, { anyOf: [{ flags: ['a'] }, { flags: ['b'] }] })).toBe(false);
    expect(conditionMet(h, { atLeast: { count: 2, of: [{ flags: ['a'] }, { files: ['ledger.mdl'] }, {}] } })).toBe(true);
    expect(conditionMet(h, { atLeast: { count: 3, of: [{ flags: ['a'] }, { files: ['ledger.mdl'] }, {}] } })).toBe(false);
  });
});

describe('Ladder outcomes in conditions', () => {
  it('a truce made before the story could read it is filled in on load', () => {
    const content = world();
    const h = game(content);
    h.ladder.outcomes['sable'] = 'truce';
    syncWithContent(h, content);
    expect(conditionMet(h, { flags: ['ladder:sable:truce'] })).toBe(true);
  });
});

describe('Endings file', () => {
  it('refuses a final job that could leave a save with fewer than two endings', () => {
    const ids = patrons.map((patron) => patron.id);
    expect(() => checkEndings(endings, [finale], ids)).not.toThrow();
    const stuck: ContractDef = { ...finale, ending: undefined, choices: finale.choices!.map((choice) => (choice.id === 'daylight' ? { ...choice, when: { flags: ['x'] } } : choice)) } as ContractDef;
    expect(() => checkEndings(endings, [stuck], ids)).toThrow(/at least two/);
    expect(() => checkEndings(endings, [{ ...finale, ending: 'nope' }], ids)).toThrow(/not an ending/);
  });

  it('has the five endings of the plan, and the Chorus one is the doom ending', () => {
    expect(endings.map((ending) => ending.id)).toEqual(['quiet', 'daylight', 'unbound', 'treaty', 'chorus']);
    expect(chorus.doom?.ending).toBe('chorus');
    expect(chorus.doom?.warnings).toHaveLength(3);
  });
});
