import { describe, expect, it } from 'vitest';
import { applyAction, createGame, guideStep, syncWithContent, tick, type Action, type Content, type GameState } from '../core';
import { companies, contracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story, tuning, news } from './index';

const content: Content = {
  servers,
  startingServers: gameInfo.startingServers,
  programs,
  startingPrograms: gameInfo.startingPrograms,
  contracts,
  mail,
  people,
  models,
  hardware,
  companies,
  skills,
  modules,
  rivals,
  story,
  news,
  rules: tuning,
};

const newGame = (): GameState => syncWithContent(createGame({ seed: 5, handle: 'T', startDate: tuning.startDate, startingBalance: tuning.startingBalance }), content);
const act = (state: GameState, action: Action) => {
  const result = applyAction(state, action, content);
  expect(result).toEqual({ ok: true });
};
const wait = (state: GameState, seconds: number) => {
  for (let i = 0; i < seconds * 4; i++) tick(state, 250, content);
};
const stepId = (state: GameState) => guideStep(state, content)?.id;

describe('the guided first job', () => {
  it('walks the library job one press at a time', () => {
    const state = newGame();
    expect(stepId(state)).toBe('goto');
    act(state, { type: 'connect', serverId: 'backroom' });
    expect(stepId(state)).toBe('login');
    act(state, { type: 'login', connectionId: state.connections[0]!.id, user: 'member' });
    expect(stepId(state)).toBe('accept');
    act(state, { type: 'acceptContract', connectionId: state.connections[0]!.id, contractId: 'tallis-cards' });
    expect(stepId(state)).toBe('leave-board');
    act(state, { type: 'disconnect', connectionId: state.connections[0]!.id });
    expect(stepId(state)).toBe('goto-target');
    act(state, { type: 'connect', serverId: 'tallis-library' });
    expect(stepId(state)).toBe('break');
    act(state, { type: 'runProgram', connectionId: state.connections[0]!.id, target: { kind: 'password', user: 'sysop' } });
    expect(stepId(state)).toBe('wait');
    wait(state, 120);
    expect(stepId(state)).toBe('enter');
    act(state, { type: 'login', connectionId: state.connections[0]!.id, user: 'sysop' });
    expect(stepId(state)).toBe('copy');
    act(state, { type: 'runProgram', connectionId: state.connections[0]!.id, target: { kind: 'copyFile', file: 'member_cards.dat' } });
    wait(state, 120);
    expect(['scrub', 'leave-target']).toContain(stepId(state));
    act(state, { type: 'disconnect', connectionId: state.connections[0]!.id });
    expect(stepId(state)).toBe('deliver');
    act(state, { type: 'deliverContract' });
    expect(guideStep(state, content)).toBeNull();
  });

  it('stays out of the way when the player takes a different job first', () => {
    const state = newGame();
    state.contracts.activeId = 'kestrel-ledger';
    expect(guideStep(state, content)).toBeNull();
  });

  it('never traces anyone at the library, and the next job traces slowly', () => {
    const state = newGame();
    act(state, { type: 'connect', serverId: 'tallis-library' });
    act(state, { type: 'runProgram', connectionId: state.connections[0]!.id, target: { kind: 'password', user: 'sysop' } });
    wait(state, 600);
    expect(state.connections[0]?.trace.status).toBe('none');

    const next = newGame();
    next.knownServers.push('kestrel-net');
    act(next, { type: 'connect', serverId: 'kestrel-net' });
    act(next, { type: 'runProgram', connectionId: next.connections[0]!.id, target: { kind: 'password', user: 'noc' } });
    wait(next, 22);
    expect(next.connections[0]?.trace.status).not.toBe('none');
    expect(next.connections[0]!.trace.hopMs[0]).toBeGreaterThanOrEqual(10_000);
  });
});
