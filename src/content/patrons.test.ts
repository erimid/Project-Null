import { describe, expect, it } from 'vitest';
import { createGame, deserializeGame, postJobs, serializeGame, shopFor, syncWithContent, worldFor, type Content, type GameState } from '../core';
import { beginRaid } from '../core/raid';
import { punish } from '../core/contracts';
import { INNER, TRUSTED, assignPatron, knownPatrons, noteDelivery, shiftStanding, standingName, standingWith } from '../core/patrons';
import { createRng } from '../core/rng';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news, patrons, ladder, type ContractDef } from './index';

const written: Content = { servers, startingServers: gameInfo.startingServers, programs, startingPrograms: gameInfo.startingPrograms, contracts, mail, people, models, hardware, companies, skills, modules, rivals, story, news, patrons, ladder, rules: tuning };
const SEED = 21;
const content = worldFor(written, SEED);

const newGame = (): GameState => syncWithContent(createGame({ seed: SEED, handle: 'Kestrel', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
const inSector = (sector: string) => content.servers.find((server) => server.generated?.sector === sector)!;
const jobAt = (targetId: string, extra: Partial<ContractDef> = {}): ContractDef & { expiresMs: number } => ({
  id: `job-${targetId}`,
  title: 't',
  client: 'A client',
  targetId,
  pay: 1000,
  rating: 1,
  minRating: 0,
  summary: 's',
  brief: 'The brief.',
  objective: { kind: 'destroy', file: 'x.dat' },
  expiresMs: 0,
  ...extra,
});
const halyard = patrons.find((patron) => patron.id === 'halyard')!;

describe('patrons', () => {
  it('post some of the board work under their own names once the rating allows', () => {
    const state = newGame();
    state.player.rating = 25;
    const seen = new Set<string>();
    for (let round = 0; round < 12; round++) {
      state.clock.gameTimeMs += (tuning.jobHours + 1) * 3_600_000;
      postJobs(state, content);
      for (const job of state.contracts.jobs) {
        if (!job.patron) continue;
        const patron = patrons.find((item) => item.id === job.patron)!;
        seen.add(patron.id);
        expect(job.client).toBe(patron.name);
        expect(job.brief.endsWith(patron.signoff)).toBe(true);
        expect(patron.targets).toContain(content.servers.find((server) => server.id === job.targetId)!.generated!.sector);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect(seen.has('ais')).toBe(false);
  });

  it('remember a delivered job: a first letter, then standing that opens better pay and a discount', () => {
    const state = newGame();
    const target = inSector(halyard.targets[0]!);
    const job = jobAt(target.id, { client: halyard.name, patron: halyard.id });
    noteDelivery(state, content, job, undefined);
    expect(state.patrons.met).toEqual(['halyard']);
    expect(standingWith(state, 'halyard')).toBeGreaterThan(0);
    expect(state.messages.at(-1)!.from).toBe('Halyard');
    expect(knownPatrons(state, content).map((patron) => patron.id)).toEqual(['halyard']);

    const backroom = content.servers.find((server) => server.id === halyard.shop)!;
    const full = shopFor(state, content, backroom).priceFactor;
    shiftStanding(state, content, 'halyard', TRUSTED);
    state.player.rating = 25;
    expect(standingName(standingWith(state, 'halyard'))).toBe('Trusted');
    expect(state.messages.at(-1)!.subject).toBe(halyard.letters.trusted!.subject);
    expect(shopFor(state, content, backroom).priceFactor).toBeCloseTo(full * 0.9);
    const paid = assignPatron(state, content, jobAt(target.id), target, { ...createRng(1), chance: () => true, pick: <T,>(items: readonly T[]) => items.find((item) => (item as { id?: string }).id === 'halyard') ?? items[0]! });
    expect(paid.patron).toBe('halyard');
    expect(paid.pay).toBe(1250);
  });

  it('take it badly when the player hurts a business they look after, and stop posting work', () => {
    const state = newGame();
    state.player.rating = 25;
    const calder = patrons.find((patron) => patron.id === 'calder')!;
    const lender = inSector(calder.protects[0]!);
    for (let i = 0; i < 2; i++) noteDelivery(state, content, jobAt(lender.id), undefined);
    expect(standingWith(state, 'calder')).toBe(-2);
    expect(standingName(-2)).toBe('Cold');
    const clinic = inSector('clinic');
    const always = { ...createRng(1), chance: () => true, pick: <T,>(items: readonly T[]) => items.find((item) => (item as { id?: string }).id === 'calder') ?? items[0]! };
    expect(assignPatron(state, content, jobAt(clinic.id), clinic, always).patron).not.toBe('calder');
  });

  it('can work through a front without the player being told', () => {
    const state = newGame();
    const checkpoint = contracts.find((contract) => contract.id === 'story-checkpoint')!;
    expect(checkpoint.patron).toBe('calder');
    const before = state.messages.length;
    noteDelivery(state, content, checkpoint, undefined);
    expect(standingWith(state, 'calder')).toBe(2);
    expect(state.patrons.met).toEqual([]);
    expect(state.messages.length).toBe(before);
  });

  it('record how a contract with a choice was finished, and move standing for the choice', () => {
    const state = newGame();
    const ledger = contracts.find((contract) => contract.id === 'story-ledger')!;
    noteDelivery(state, content, ledger, ledger.choices!.find((choice) => choice.id === 'daylight'));
    expect(state.patrons.choices['story-ledger']).toBe('daylight');
    expect(standingWith(state, 'daylight')).toBe(3);
    const sunday = contracts.find((contract) => contract.id === 'tallis-sunday')!;
    noteDelivery(state, content, sunday, undefined);
    expect(state.patrons.choices['tallis-sunday']).toBe('default');
  });

  it('fill in the choices of an old save from what is still on the gateway', () => {
    const state = newGame();
    const checkpoint = contracts.find((contract) => contract.id === 'story-checkpoint')!;
    state.contracts.completed.push('story-checkpoint', 'story-ledger');
    state.player.files.push({ name: 'ledger_partial.arc', sizeGq: 1, from: checkpoint.targetId });
    const old = JSON.parse(serializeGame(state, '2030-01-01T00:00:00Z'));
    delete old.state.patrons;
    old.state.flags = old.state.flags.filter((flag: string) => flag !== 'choices-recorded');
    old.version = old.state.version = 20;
    const loaded = syncWithContent(deserializeGame(JSON.stringify(old)).state, content);
    expect(loaded.patrons.choices).toEqual({ 'story-checkpoint': 'keep', 'story-ledger': 'default' });
  });

  it('do their favours for the inner circle', () => {
    const state = newGame();
    const target = content.servers.find((server) => server.id === 'corvane-mutual')!;
    state.player.balance = 100_000;
    const plain = punish(JSON.parse(JSON.stringify(state)) as GameState, content, target.id);
    shiftStanding(state, content, 'calder', INNER);
    shiftStanding(state, content, 'office', INNER);
    const helped = punish(state, content, target.id);
    expect(helped.fine).toBe(Math.round(plain.fine / 2));
    expect(helped.hours).toBe(plain.hours / 2);

    const raider = rivals[0]!;
    const cold = newGame();
    beginRaid(cold, content, raider.id);
    shiftStanding(state, content, 'halyard', INNER);
    beginRaid(state, content, raider.id);
    expect(state.raid!.breachTotalMs).toBeGreaterThan(cold.raid!.breachTotalMs);
  });
});
