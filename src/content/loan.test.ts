import { describe, expect, it } from 'vitest';
import { applyAction, quietTarget, type GameState } from '../core';
import { maybeLend } from '../core/loan';
import { gameInfo, tuning, assets } from './index';
import { content, fresh } from './storyPlay';

describe("the fixer's loan in the real game", () => {
  const broke = (rating: number): GameState => {
    const state = fresh();
    state.player.rating = rating;
    state.player.balance = 120;
    state.loan.marks = [
      { balance: 900, rating: rating + 1 },
      { balance: 500, rating },
      { balance: 120, rating },
    ];
    return state;
  };

  it('has one loan for every career title', () => {
    expect(tuning.loan.titles).toEqual(gameInfo.ratings.map((rating) => rating.min));
  });

  it('lends enough for a few fines, and puts a quiet job on the board that nobody traces', () => {
    const state = broke(8);
    maybeLend(state, content);
    expect(state.loan.owed).toBe(3100);
    expect(state.player.balance).toBe(3220);
    const job = state.contracts.jobs.find((item) => item.quiet);
    expect(job).toBeDefined();
    expect(job!.title).toMatch(/^Quiet work: /);
    expect(state.messages.at(-1)!.body).toContain(job!.title);
    expect(state.messages.at(-1)!.body).toContain('3,100 credits');
    // The easiest kind of company, whatever the player's rating.
    expect(content.servers.find((server) => server.id === job!.targetId)!.generated!.tier).toBe(1);

    // Taken, its server starts no trace however long the player stays.
    state.contracts.activeId = job!.id;
    expect(quietTarget(state, job!.targetId)).toBe(true);
    state.knownServers.push(job!.targetId);
    expect(applyAction(state, { type: 'connect', serverId: job!.targetId }, content)).toEqual({ ok: true });
    expect(state.connections[0]!.trace.status).toBe('none');
    const user = content.servers.find((server) => server.id === job!.targetId)!.accounts.find((account) => account.role === 'admin')!.user;
    expect(applyAction(state, { type: 'runProgram', connectionId: state.connections[0]!.id, target: { kind: 'password', user } }, content)).toEqual({ ok: true });
    expect(state.connections[0]!.trace.status).toBe('none');
  });

  it('sells three late properties for about what a frugal career leaves unspent', () => {
    const late = assets.filter((asset) => ['spareHands', 'nightDesk', 'cutOut'].includes(asset.effect));
    expect(late).toHaveLength(3);
    const total = late.reduce((sum, asset) => sum + asset.price, 0);
    expect(total).toBeGreaterThan(250_000);
    expect(total).toBeLessThan(350_000);
    for (const asset of late) expect(asset.minRating).toBeGreaterThanOrEqual(79);
  });
});
