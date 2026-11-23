/**
 * The writing step of the ChatGPT-feedback plan: the early anomaly job and
 * the leads it opens, the curious-player letters, Daylight's honest count,
 * a human voice before the finale, and the check-the-client jobs.
 */
import { describe, expect, it } from 'vitest';
import { createGame, syncWithContent, type GameState } from '../core';
import { advanceStory, beatPassed, gateRating } from '../core/story';
import { readClueFlag } from '../core/conditions';
import { contracts, news, chorus, servers, story, linesOf, tuning, gameInfo } from './index';
import { content as worldContent, fresh, play } from './storyPlay';

const contract = (id: string) => contracts.find((item) => item.id === id)!;
const beat = (id: string) => story.beats.find((item) => item.id === id)!;
const FLAG = 'rewritten:kestrel-net/uptime_audit_feb.txt';

function newGame(): GameState {
  return syncWithContent(createGame({ seed: 31, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: 5000 }), worldContent);
}

describe('The early anomaly', () => {
  it('is an ordinary early job whose copy differs from the file on the server, and says so in the log first', () => {
    const job = contract('kestrel-audit');
    expect(job.story).toBeUndefined();
    expect(job.minRating).toBeLessThanOrEqual(3);
    const rewrite = job.twists!.find((twist) => twist.kind === 'rewrite')!;
    const server = servers.find((item) => item.id === 'kestrel-net')!;
    const file = server.files.find((item) => item.name === 'uptime_audit_feb.txt')!;
    expect(file.content).toMatchObject({ kind: 'text' });
    expect(rewrite.kind === 'rewrite' && rewrite.text.startsWith((file.content as { text: string }).text)).toBe(true);
    expect(job.twists!.some((twist) => twist.kind === 'log')).toBe(true);
  });

  it('brings Halvorsen’s job forward to about job nine, but only for a player who met it', () => {
    const state = newGame();
    const lantern = contract('halvorsen-lantern');
    expect(gateRating(state, lantern)).toBe(15);
    state.flags.push(FLAG);
    expect(gateRating(state, lantern)).toBeLessThanOrEqual(8);
    expect(gateRating(state, lantern)).toBeGreaterThanOrEqual(7);
  });

  it('writes two letters, the second when the board shows the new job, and keeps Vesper offstage', () => {
    const state = newGame();
    state.flags.push(FLAG);
    state.player.rating = 3;
    for (let step = 0; step < 12; step++) {
      advanceStory(state, worldContent);
      state.clock.gameTimeMs += 6 * 3_600_000;
    }
    expect(beatPassed(state, 'e-treasurer')).toBe(true);
    expect(beatPassed(state, 'e-wren')).toBe(false);
    state.player.rating = gateRating(state, contract('halvorsen-lantern'));
    for (let step = 0; step < 12; step++) {
      advanceStory(state, worldContent);
      state.clock.gameTimeMs += 6 * 3_600_000;
    }
    expect(beatPassed(state, 'e-wren')).toBe(true);
    const early = linesOf(story).find((line) => line.id === 'early')!;
    for (const item of early.beats) expect(item.mail?.from).not.toBe('Vesper');
    expect(state.messages.find((message) => message.from === 'Wren' && /Halvorsen/.test(message.body))).toBeTruthy();
  });
});

describe('Leads for a curious player', () => {
  it('lets the audit log and the node’s quiet files pull Vesper’s jobs sooner', () => {
    const state = newGame();
    const look = beat('look');
    const courier = beat('courier');
    expect(gateRating(state, look)).toBe(18);
    expect(gateRating(state, courier)).toBe(43);
    state.flags.push(readClueFlag('halvorsen/audit.log'));
    expect(gateRating(state, look)).toBeLessThan(18);
    state.flags.push(readClueFlag('still-point/quiet_hours.txt'));
    expect(gateRating(state, courier)).toBeLessThan(43);
    // The jobs the beats offer carry the same lead, so the board agrees with the story.
    expect(gateRating(state, contract('story-stillpoint'))).toBe(gateRating(state, look));
    expect(gateRating(state, contract('story-courier'))).toBe(gateRating(state, courier));
  });

  it('writes a letter only for someone who read the file', () => {
    for (const id of ['vesper-audit', 'inhuman-quiet', 'warning-read']) {
      const item = beat(id);
      expect(item.if, id).toBeDefined();
      expect(item.mail?.from, id).toBe('Vesper');
    }
  });
});

describe('Before the finale', () => {
  it('has Daylight say what it can stand on, differently if the register or the fragment went to it', () => {
    const proved = fresh();
    play(proved, {}, ['act4-asking'], 80);
    expect(proved.flags).toContain('proof-early');
    expect(beatPassed(proved, 'a3-day-proves')).toBe(true);
    expect(beatPassed(proved, 'a3-day-short')).toBe(false);
    const bare = fresh();
    play(bare, { 'act3-list': 'office', 'story-ledger': 'keep' }, ['act4-asking'], 80);
    expect(bare.flags).not.toContain('proof-early');
    expect(beatPassed(bare, 'a3-day-short')).toBe(true);
    expect(bare.messages.find((message) => message.from === 'Daylight' && message.subject === 'what we can stand on')?.body).toMatch(/not much/);
  });

  it('has a human write before the last job is offered, not an AI and not a patron', () => {
    const state = fresh();
    play(state, {}, ['act4-asking'], 80);
    const letter = state.messages.find((message) => /Ines Verhoeven/.test(message.from));
    expect(letter?.body).toMatch(/did not drop a single ward/);
    const ids = linesOf(story).find((line) => line.id === 'main')!.beats.map((item) => item.id);
    expect(ids.indexOf('a4-ines')).toBe(ids.indexOf('a4-what-it-said') + 1);
    expect(ids.indexOf('a4-the-asking')).toBe(ids.indexOf('a4-ines') + 1);
    expect(beatPassed(state, 'a4-ines')).toBe(true);
  });

  it('shows Chorus spreading in the paper while the story waits', () => {
    expect(chorus.news.length).toBeGreaterThanOrEqual(6);
    const after = news.story.filter((item) => /^(a3|a4)-/.test(item.after)).map((item) => item.after);
    for (const id of ['a3-wick-ask', 'a3-office-ask', 'a3-day-hire', 'a3-v-lines', 'a3-name', 'a4-wren-asks']) expect(after).toContain(id);
    expect(chorus.doom!.warnings.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Check the client', () => {
  const claims = ['kestrel-count', 'meridian-hold', 'aldergate-hours', 'tessera-shares'];

  it('asks a question about a file the player has to read, and pays by whether they read it right', () => {
    for (const id of claims) {
      const job = contract(id);
      expect(job.story, id).toBeUndefined();
      expect(job.objective.kind, id).toBe('read');
      expect(job.decide?.question, id).toBeTruthy();
      const server = servers.find((item) => item.id === job.targetId)!;
      const file = job.objective.kind === 'read' ? job.objective.file : '';
      expect(server.files.find((item) => item.name === file)?.content, id).toMatchObject({ kind: 'text' });
      expect(job.choices!.length, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('has a client who is right, one who is half right, and one who is lying', () => {
    // Right: the usual way is the true answer and pays best.
    for (const id of ['kestrel-count', 'meridian-hold']) {
      const job = contract(id);
      for (const choice of job.choices!) {
        expect(choice.pay, id).toBeLessThan(job.pay);
        expect(choice.rating, id).toBeLessThan(job.rating);
      }
    }
    // Half right: agreeing pays a little, saying it is worse pays and rates best, saying it is nothing is worst.
    const half = contract('aldergate-hours');
    const worse = half.choices!.find((choice) => choice.id === 'worse')!;
    const nothing = half.choices!.find((choice) => choice.id === 'not-twice')!;
    expect(worse.pay).toBeGreaterThan(half.pay);
    expect(worse.rating).toBeGreaterThan(half.rating);
    expect(nothing.pay).toBeLessThan(half.pay);
    // Lying: what he wants pays more, the truth is worth more to a name.
    const liar = contract('tessera-shares');
    const truth = liar.choices!.find((choice) => choice.id === 'plan')!;
    expect(truth.pay).toBeLessThan(liar.pay);
    expect(truth.rating).toBeGreaterThan(liar.rating);
  });

  it('puts them in the middle of the climb, in the ordinary board’s tone', () => {
    const ratings = claims.map((id) => contract(id).minRating);
    expect([...ratings].sort((a, b) => a - b)).toEqual(ratings);
    expect(Math.min(...ratings)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...ratings)).toBeLessThan(gameInfo.ratings[6]!.min + 5);
  });
});
