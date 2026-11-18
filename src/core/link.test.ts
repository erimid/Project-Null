import { describe, expect, it } from 'vitest';
import { applyAction, createGame, heldBy, holding, mostUrgentTrace, syncWithContent, tick, tracesByUrgency, type Action, type GameState } from './index';
import { content } from './testWorld';

/*
 * Test world reminders: the Watched Tower traces from the moment you
 * connect, but its monitor reports to the Security Desk; an admin login
 * on the desk ("guard") keeps it busy. The Fort's firewall (level 5,
 * beyond any program) is run from the Gatehouse ("ops"). Both need two
 * connections at once: ports-2 in the test hardware.
 */

function game() {
  const state: GameState = syncWithContent(
    createGame({ seed: 9, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 1000 }),
    content,
  );
  state.knownServers = content.servers.map((server) => server.id);
  state.player.hardware.ports = 3;
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const open = (serverId: string, user?: string) => {
    ok({ type: 'connect', serverId });
    const id = state.connections.at(-1)!.id;
    if (user) ok({ type: 'login', connectionId: id, user });
    return id;
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) tick(state, 250, content);
  };
  return { state, act, ok, refused, open, run };
}

describe('a monitor run from another server', () => {
  it('traces as usual while nobody holds the desk', () => {
    const h = game();
    h.open('tower');
    expect(h.state.connections[0]!.trace.status).toBe('active');
    h.run(1);
    expect(h.state.connections[0]!.trace.elapsedMs).toBeGreaterThan(0);
  });

  it('stands still while the desk is held by an admin login', () => {
    const h = game();
    const desk = h.open('desk', 'guard');
    const tower = h.open('tower', 'admin');
    const trace = () => h.state.connections.find((c) => c.id === tower)!.trace;
    expect(heldBy(h.state, content, 'tower', 'monitor')?.id).toBe(desk);
    h.run(30);
    expect(trace().elapsedMs).toBe(0);
    // Let go of the desk and the trace moves again.
    h.ok({ type: 'logout', connectionId: desk });
    h.run(1);
    expect(trace().elapsedMs).toBeGreaterThan(0);
  });

  it('notices nothing done while it is held', () => {
    const h = game();
    h.state.connections = [];
    const desk = h.open('desk', 'guard');
    // The Tower's own monitor would start a trace at connect; take that away to watch intrusions alone.
    const tower = h.open('tower', 'admin');
    const connection = h.state.connections.find((c) => c.id === tower)!;
    connection.trace.status = 'none';
    h.ok({ type: 'runProgram', connectionId: tower, target: { kind: 'copyFile', file: 'plans.dat' } });
    expect(connection.trace.status).toBe('none');
    h.ok({ type: 'disconnect', connectionId: desk });
    h.ok({ type: 'runProgram', connectionId: tower, target: { kind: 'deleteFile', file: 'plans.dat' } });
    expect(connection.trace.status).not.toBe('none');
  });

  it('a guest login on the desk does not hold it', () => {
    const h = game();
    h.open('desk');
    h.open('tower');
    expect(heldBy(h.state, content, 'tower', 'monitor')).toBeUndefined();
  });

  it('puts a held trace behind a moving one', () => {
    const h = game();
    h.open('desk', 'guard');
    const tower = h.open('tower');
    const vault = h.open('vault');
    expect(tracesByUrgency(h.state, content).map((c) => c.id)).toEqual([vault, tower]);
    expect(mostUrgentTrace(h.state, content)?.id).toBe(vault);
  });
});

describe('a firewall run from another server', () => {
  it('blocks copying, and no program can get past it', () => {
    const h = game();
    const fort = h.open('fort', 'admin');
    h.refused({ type: 'runProgram', connectionId: fort, target: { kind: 'copyFile', file: 'bundle.dat' } }, /firewall/);
    h.refused({ type: 'runProgram', connectionId: fort, target: { kind: 'firewall' } }, /too weak/);
  });

  it('passes everything while the gatehouse is held', () => {
    const h = game();
    const gate = h.open('gatehouse', 'ops');
    const fort = h.open('fort', 'admin');
    h.refused({ type: 'runProgram', connectionId: fort, target: { kind: 'firewall' } }, /held open/);
    h.ok({ type: 'runProgram', connectionId: fort, target: { kind: 'deleteFile', file: 'bundle.dat' } });
    h.run(5);
    expect(h.state.servers.fort!.files).toEqual([]);
    expect(holding(content, h.state.connections.find((c) => c.id === gate)!)).toEqual([{ serverId: 'fort', layer: 'firewall' }]);
  });

  it('closes again when the gatehouse login ends', () => {
    const h = game();
    const gate = h.open('gatehouse', 'ops');
    const fort = h.open('fort', 'admin');
    h.ok({ type: 'disconnect', connectionId: gate });
    h.refused({ type: 'runProgram', connectionId: fort, target: { kind: 'copyFile', file: 'bundle.dat' } }, /firewall/);
  });

  it('needs a second port', () => {
    const h = game();
    h.state.player.hardware.ports = 1;
    h.open('gatehouse', 'ops');
    h.refused({ type: 'connect', serverId: 'fort' }, /one connection/);
  });
});
