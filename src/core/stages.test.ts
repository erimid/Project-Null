import { describe, expect, it } from 'vitest';
import { applyAction, contractRisk, createGame, currentStage, stageIndex, syncWithContent, tick, type Action } from './index';
import type { ContractDef } from '../content/schema';
import { content as baseContent } from './testWorld';
import type { Content } from './world';

/**
 * Multi-stage contracts against the test world. A two-stage job: read a
 * note at the directory that reveals corp's admin login, then copy
 * corp's secret. A later stage can raise a layer and move a file.
 */
function world(contracts: ContractDef[]): Content {
  return { ...baseContent, contracts };
}

function harness(contracts: ContractDef[]) {
  const content = world(contracts);
  const state = syncWithContent(createGame({ seed: 2, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 10_000 }), content);
  state.knownServers = content.servers.map((server) => server.id);
  state.player.programs = [...state.player.programs, 'breaker-2', 'gold-plated'];
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const here = () => state.connections[0]!.id;
  const visit = (serverId: string, user?: string) => {
    ok({ type: 'disconnectAll' });
    ok({ type: 'connect', serverId });
    if (user) {
      state.player.passwords[serverId] = [user];
      ok({ type: 'login', connectionId: here(), user });
      state.connections[0]!.bypassed = { proxy: true, firewall: true };
    }
  };
  return { state, content, act, ok, here, visit };
}

const twoStage: ContractDef = {
  id: 'chain',
  title: 'Two steps',
  client: 'Client',
  targetId: 'directory',
  pay: 1000,
  rating: 2,
  minRating: 0,
  summary: 'Read then steal.',
  brief: 'First read the note.',
  objective: { kind: 'read', file: 'readme.txt' },
  stages: [{ targetId: 'corp', objective: { kind: 'steal', file: 'secret.dat' }, brief: 'Now take the secret.' }],
};

describe('contracts with stages', () => {
  it('starts on the first step and moves on as each goal is met', () => {
    const { state, ok, here, visit, content } = harness([twoStage]);
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'chain' });
    expect(stageIndex(state, twoStage)).toBe(0);
    expect(currentStage(state, twoStage).targetId).toBe('directory');

    // Read the note: the step is done, so the contract moves to step two.
    visit('directory', 'guest');
    ok({ type: 'readFile', serverId: 'directory', name: 'readme.txt' });
    expect(stageIndex(state, twoStage)).toBe(1);
    expect(currentStage(state, twoStage).targetId).toBe('corp');
    // Not deliverable until the last step is done.
    expect(applyAction(state, { type: 'deliverContract' }, content).ok).toBe(false);

    // Take the secret and deliver.
    visit('corp', 'admin');
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'copyFile', file: 'secret.dat' } });
    for (let i = 0; i < 400 && state.tasks.length > 0; i++) tick(state, 1000, content);
    ok({ type: 'disconnectAll' });
    const before = state.player.balance;
    ok({ type: 'deliverContract' });
    expect(state.player.balance).toBe(before + 1000);
    expect(state.player.rating).toBe(2);
    expect(state.contracts.activeId).toBe(null);
    // The stolen file was handed over.
    expect(state.player.files.some((file) => file.name === 'secret.dat')).toBe(false);
  });

  it('a read goal that reveals a login grants the password and address', () => {
    const reveal: ContractDef = {
      ...twoStage,
      id: 'reveal',
      objective: { kind: 'read', file: 'readme.txt', reveals: { serverId: 'corp', user: 'admin' } },
      stages: [{ targetId: 'corp', objective: { kind: 'steal', file: 'secret.dat' } }],
    };
    const { state, ok, here, visit } = harness([reveal]);
    delete state.player.passwords.corp;
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'reveal' });
    visit('directory', 'guest');
    ok({ type: 'readFile', serverId: 'directory', name: 'readme.txt' });
    expect(state.player.passwords.corp).toContain('admin');
  });

  it('plant puts a client file onto the target, then hands nothing over', () => {
    const plant: ContractDef = {
      id: 'plant',
      title: 'Plant it',
      client: 'C',
      targetId: 'corp',
      pay: 500,
      rating: 1,
      minRating: 0,
      summary: 'Plant evidence.',
      brief: 'Put this file on their server.',
      objective: { kind: 'plant', file: 'evidence.dat', sizeGq: 1 },
    };
    const { state, ok, here, visit, content } = harness([plant]);
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'plant' });
    // The client's file is on the gateway now.
    expect(state.player.files.some((file) => file.name === 'evidence.dat')).toBe(true);
    visit('corp', 'admin');
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'uploadFile', file: 'evidence.dat' } });
    for (let i = 0; i < 400 && state.tasks.length > 0; i++) tick(state, 1000, content);
    expect(state.servers.corp!.files.some((file) => file.name === 'evidence.dat')).toBe(true);
    expect(state.player.files.some((file) => file.name === 'evidence.dat')).toBe(false);
    ok({ type: 'disconnectAll' });
    ok({ type: 'deliverContract' });
    expect(state.contracts.activeId).toBe(null);
  });

  it('a raise twist puts the next step target on its guard for a while', () => {
    const raised: ContractDef = {
      ...twoStage,
      id: 'raised',
      stages: [{ targetId: 'corp', objective: { kind: 'steal', file: 'secret.dat' }, twists: [{ kind: 'raise', layer: 'firewall', by: 2 }] }],
    };
    const { state, ok, here, visit } = harness([raised]);
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'raised' });
    visit('directory', 'guest');
    ok({ type: 'readFile', serverId: 'directory', name: 'readme.txt' });
    // Corp's firewall was 1; the guard adds 2.
    expect(state.servers.corp!.alert).toBeDefined();
    expect(state.servers.corp!.alert!.raise.firewall).toBe(2);
  });

  it('a late step loses the contract', () => {
    const timed: ContractDef = {
      ...twoStage,
      id: 'timed',
      stages: [{ targetId: 'corp', objective: { kind: 'steal', file: 'secret.dat' }, withinMinutes: 10 }],
    };
    const { state, ok, here, visit, content } = harness([timed]);
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'timed' });
    visit('directory', 'guest');
    ok({ type: 'readFile', serverId: 'directory', name: 'readme.txt' });
    ok({ type: 'disconnectAll' });
    // Let the clock run past the window.
    for (let i = 0; i < 20; i++) tick(state, 60_000, content);
    expect(state.contracts.activeId).toBe(null);
  });

  it('a delivery choice pays differently and can keep the goods', () => {
    const choice: ContractDef = {
      id: 'choice',
      title: 'Sell it on',
      client: 'C',
      targetId: 'corp',
      pay: 500,
      rating: 2,
      minRating: 0,
      summary: 'Copy the secret.',
      brief: 'Bring it back.',
      objective: { kind: 'steal', file: 'secret.dat' },
      choices: [{ id: 'rival', label: 'Sell to the rival', note: 'More money, less standing.', pay: 1500, rating: -1, keep: true }],
    };
    const { state, ok, here, visit, content } = harness([choice]);
    visit('hidden', 'member');
    ok({ type: 'acceptContract', connectionId: here(), contractId: 'choice' });
    visit('corp', 'admin');
    ok({ type: 'runProgram', connectionId: here(), target: { kind: 'copyFile', file: 'secret.dat' } });
    for (let i = 0; i < 400 && state.tasks.length > 0; i++) tick(state, 1000, content);
    ok({ type: 'disconnectAll' });
    const before = state.player.balance;
    ok({ type: 'deliverContract', choiceId: 'rival' });
    expect(state.player.balance).toBe(before + 1500);
    // Kept: still on the gateway.
    expect(state.player.files.some((file) => file.name === 'secret.dat')).toBe(true);
  });
});

describe('the risk a job card shows', () => {
  const job = (targetId: string, stages: ContractDef['stages'] = []): ContractDef => ({
    id: `risk-${targetId}`,
    title: 'Risk',
    client: 'Client',
    targetId,
    pay: 100,
    rating: 1,
    minRating: 0,
    summary: 's',
    brief: 'b',
    objective: { kind: 'steal', file: 'x' },
    ...(stages.length > 0 ? { stages } : {}),
  });

  it('is the strongest layer on the target', () => {
    const { state, content } = harness([]);
    expect(contractRisk(state, content, job('directory'))).toBe(0);
    expect(contractRisk(state, content, job('corp'))).toBe(1);
    expect(contractRisk(state, content, job('vault'))).toBe(3);
    expect(contractRisk(state, content, job('fort'))).toBe(5);
  });

  it('takes the worst server of a job with several steps', () => {
    const { state, content } = harness([]);
    const staged = job('corp', [{ targetId: 'fort', objective: { kind: 'read', file: 'x' } }]);
    expect(contractRisk(state, content, staged)).toBe(5);
  });

  it('ignores a target that is not in the world', () => {
    const { state, content } = harness([]);
    expect(contractRisk(state, content, job('nowhere'))).toBe(0);
  });
});
