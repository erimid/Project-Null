import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  applyAction,
  createGame,
  deserializeGame,
  evidenceCount,
  relayHeat,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type Content,
  type Difficulty,
  type GameState,
} from './index';
import { loseHardware } from './hardware';
import { maybeLend, repayLoan } from './loan';
import { content } from './testWorld';

/*
 * Test world reminders: corp has every layer at level 1 and takes 10s a
 * hop to trace (5s direct); a fine is 20 a level, so 80 at corp. Relays
 * cool in 8 hours. The breaker takes 10s.
 */

const LOAN = { below: 100, base: 500, perRating: 100, repayShare: 0.25, titles: [0, 5, 10] };
const assets = [
  { id: 'loft', name: 'Loft', where: 'X', blurb: 'b', price: 10, minRating: 0, effect: 'spareHands' as const },
  { id: 'desk', name: 'Desk', where: 'X', blurb: 'b', price: 10, minRating: 0, effect: 'nightDesk' as const },
  { id: 'cut', name: 'Cut', where: 'X', blurb: 'b', price: 10, minRating: 0, effect: 'cutOut' as const },
];
const world: Content = { ...content, assets, rules: { ...content.rules, loan: LOAN } };

function game(difficulty?: Difficulty, balance = 1000) {
  const state: GameState = syncWithContent(
    createGame({ seed: 5, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: balance, ...(difficulty ? { difficulty } : {}) }),
    world,
  );
  state.knownServers = world.servers.map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, world);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const wait = (seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) tick(state, 250, world);
  };
  /** Walks into corp with a known password and stays until the trace lands. */
  const getCaught = (route: string[] = []) => {
    state.player.passwords.corp = ['admin'];
    for (const serverId of route) ok({ type: 'addHop', serverId });
    ok({ type: 'connect', serverId: 'corp' });
    ok({ type: 'login', connectionId: state.connections[0]!.id, user: 'admin' });
    wait(120);
    expect(state.connections).toEqual([]);
    ok({ type: 'clearRoute' });
  };
  return { state, act, ok, wait, getCaught };
}

describe('difficulty modes', () => {
  it('start on Standard unless told otherwise, and can be changed at any time', () => {
    const h = game();
    expect(h.state.difficulty).toBe('standard');
    h.ok({ type: 'setDifficulty', difficulty: 'hard' });
    expect(h.state.difficulty).toBe('hard');
    expect(h.act({ type: 'setDifficulty', difficulty: 'ironman' as Difficulty })).toMatchObject({ ok: false });
    expect(game('story').state.difficulty).toBe('story');
  });

  it('stretch a trace by 30% on Story and shorten it by a quarter on Hard', () => {
    const hop = (difficulty: Difficulty) => {
      const h = game(difficulty);
      h.ok({ type: 'addHop', serverId: 'relay-b' });
      h.ok({ type: 'connect', serverId: 'corp' });
      return h.state.connections[0]!.trace.hopMs[0]!;
    };
    expect(hop('standard')).toBe(10_000);
    expect(hop('story')).toBeCloseTo(10_000 / 0.7, 3);
    expect(hop('hard')).toBeCloseTo(8000, 3);
  });

  it('halve the fine on Story', () => {
    const standard = game('standard');
    standard.getCaught();
    expect(standard.state.player.balance).toBe(920);
    const story = game('story');
    story.getCaught();
    expect(story.state.player.balance).toBe(960);
  });

  it('never burn a part out of the gateway on Story', () => {
    const strong: Content = { ...world, rules: { ...world.rules, hardwareLossLevel: 1 } };
    for (const [difficulty, kept] of [['standard', 1], ['story', 2], ['hard', 1]] as const) {
      const h = game(difficulty);
      h.state.player.hardware.cpu = 2;
      loseHardware(h.state, strong, 'corp');
      expect(h.state.player.hardware.cpu).toBe(kept);
    }
  });

  it('keep a relay hot twice as long on Hard', () => {
    const heatAfter = (difficulty: Difficulty) => {
      const h = game(difficulty);
      h.ok({ type: 'addHop', serverId: 'relay-b' });
      h.ok({ type: 'connect', serverId: 'directory' });
      h.ok({ type: 'disconnectAll' });
      h.state.clock.gameTimeMs += 4 * 3_600_000;
      return relayHeat(h.state, world, 'relay-b');
    };
    expect(heatAfter('standard')).toBeCloseTo(0.5, 3);
    expect(heatAfter('hard')).toBeCloseTo(0.75, 3);
  });

  it('are kept in a save, and an older save loads as Standard owing nothing', () => {
    const h = game('hard');
    const text = serializeGame(h.state, '2030-01-01T00:00:00Z');
    expect(deserializeGame(text).state.difficulty).toBe('hard');
    const file = JSON.parse(text) as { version: number; state: Record<string, unknown> };
    file.version = 35;
    delete file.state.difficulty;
    delete file.state.loan;
    file.state.version = 35;
    const old = deserializeGame(JSON.stringify(file)).state;
    expect(old.version).toBe(STATE_VERSION);
    expect(old.difficulty).toBe('standard');
    expect(old.loan).toEqual({ owed: 0, given: [], marks: [] });
  });
});

describe("the fixer's loan", () => {
  /** A player three jobs in whose money has gone and whose rating has not grown. */
  const broke = () => {
    const h = game('standard', 60);
    h.state.player.rating = 3;
    h.state.loan.marks = [
      { balance: 400, rating: 3 },
      { balance: 200, rating: 4 },
      { balance: 60, rating: 3 },
    ];
    return h;
  };

  it('comes after a fine once the money is gone and nothing has grown for three jobs', () => {
    const h = broke();
    h.getCaught();
    // The fine took the 60 credits; rating 2 lends 500 + 2 * 100.
    expect(h.state.loan).toMatchObject({ owed: 700, given: [0] });
    expect(h.state.player.balance).toBe(700);
    const letter = h.state.messages.at(-1)!;
    expect(letter).toMatchObject({ from: 'Wren', kind: 'work' });
    expect(letter.body).toMatch(/^700 25 /);
  });

  it('is not offered to someone who is merely poor, or who is doing better than three jobs ago', () => {
    const fine = game('standard', 60);
    fine.state.loan.marks = [{ balance: 40, rating: 0 }, { balance: 50, rating: 0 }, { balance: 60, rating: 1 }];
    fine.state.player.rating = 3;
    maybeLend(fine.state, world);
    expect(fine.state.loan.owed).toBe(0);

    const rich = broke();
    rich.state.player.balance = 5000;
    maybeLend(rich.state, world);
    expect(rich.state.loan.owed).toBe(0);

    const early = game('standard', 0);
    maybeLend(early.state, world);
    expect(early.state.loan.owed).toBe(0);
  });

  it('takes a quarter of each payment until it is square, then says so', () => {
    const h = broke();
    h.getCaught();
    h.state.player.balance += 1000;
    expect(repayLoan(h.state, world, 1000)).toBe(250);
    expect(h.state.loan.owed).toBe(450);
    h.state.player.balance += 4000;
    expect(repayLoan(h.state, world, 4000)).toBe(450);
    expect(h.state.loan.owed).toBe(0);
    expect(h.state.messages.at(-1)).toMatchObject({ subject: 'loanSquare', kind: 'work' });
    expect(h.state.player.balance).toBe(700 + 5000 - 700);
    // Nothing more is taken once it is square.
    expect(repayLoan(h.state, world, 1000)).toBe(0);
  });

  it('is given once at each title', () => {
    const h = broke();
    h.getCaught();
    h.state.loan.owed = 0;
    h.state.player.balance = 0;
    h.state.loan.marks = [{ balance: 500, rating: 4 }, { balance: 100, rating: 3 }, { balance: 0, rating: 2 }];
    maybeLend(h.state, world);
    expect(h.state.loan.owed).toBe(0);
    // A title higher, it can be asked for again.
    h.state.player.rating = 6;
    h.state.loan.marks = [{ balance: 500, rating: 7 }, { balance: 100, rating: 7 }, { balance: 0, rating: 6 }];
    maybeLend(h.state, world);
    expect(h.state.loan).toMatchObject({ owed: 1100, given: [0, 1] });
  });

  it('is not offered while one is still owed, or where the rules have none', () => {
    const h = broke();
    h.getCaught();
    h.state.player.rating = 6;
    h.state.player.balance = 0;
    maybeLend(h.state, world);
    expect(h.state.loan.owed).toBe(700);

    const none = broke();
    maybeLend(none.state, content);
    expect(none.state.loan.owed).toBe(0);
  });
});

describe('late property', () => {
  const owning = (id: string) => {
    const h = game();
    h.state.player.assets = [id];
    return h;
  };

  it('a core loft plays the password, the proxy and the key by itself', () => {
    const seconds = (assetsOwned: string[]) => {
      const h = game();
      h.state.player.assets = assetsOwned;
      h.ok({ type: 'connect', serverId: 'directory' });
      h.state.player.files.push({ name: 'sealed.dat', sizeGq: 2, from: 'corp', takenMs: 0, encrypted: 1 });
      h.ok({ type: 'decryptFile', name: 'sealed.dat' });
      let ticks = 0;
      while (h.state.tasks.length > 0 && ticks < 2000) {
        tick(h.state, 50, world);
        ticks++;
      }
      return ticks / 20;
    };
    expect(seconds([])).toBeCloseTo(8, 0);
    // The key turns 30% of the way in and takes 40% off the rest: 8 * (0.3 + 0.7 * 0.6).
    expect(seconds(['loft'])).toBeCloseTo(5.8, 0);
  });

  it('a night desk scrubs what would give the player away when they leave', () => {
    const leave = (h: ReturnType<typeof game>) => {
      h.state.player.passwords.corp = ['admin'];
      h.ok({ type: 'addHop', serverId: 'relay-a' });
      h.ok({ type: 'addHop', serverId: 'relay-b' });
      h.ok({ type: 'connect', serverId: 'corp' });
      h.ok({ type: 'login', connectionId: h.state.connections[0]!.id, user: 'admin' });
      h.ok({ type: 'disconnectAll' });
    };
    const plain = game();
    leave(plain);
    expect(evidenceCount(plain.state, 'corp')).toBeGreaterThan(0);
    expect(plain.state.reviews).toHaveLength(1);
    const desk = owning('desk');
    leave(desk);
    expect(evidenceCount(desk.state, 'corp')).toBe(0);
    expect(desk.state.reviews).toHaveLength(0);
  });

  it('a cut-out takes the first trace of a day, and only the first', () => {
    const h = owning('cut');
    h.state.player.rating = 3;
    h.getCaught();
    expect(h.state.player).toMatchObject({ balance: 1000, rating: 3, passwords: {}, lieLowUntilMs: 0 });
    expect(h.state.wanted.heat).toBe(0);
    expect(h.state.messages.at(-1)).toMatchObject({ subject: 'cutOut' });
    h.getCaught();
    expect(h.state.player.balance).toBe(920);
    expect(h.state.player.rating).toBe(2);
    // Tomorrow the name is good again.
    h.state.clock.gameTimeMs += 86_400_000;
    h.state.player.lieLowUntilMs = 0;
    h.getCaught();
    expect(h.state.player.balance).toBe(920);
  });
});
