import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canReadTrace,
  checkTask,
  cpuSpeed,
  createGame,
  jamTrace,
  sellsHardware,
  sellsModule,
  sellsOnly,
  sellsProgram,
  syncWithContent,
  tick,
  traceHeld,
  type Action,
  type Connection,
  type GameState,
  type TaskTarget,
} from './index';
import { advanceTrace } from './trace';
import { content } from './testWorld';

/*
 * Step 4 gear. The test world has a general store ("hidden") and a
 * specialist shop ("bazaar"): only Scanners as staple programs, every
 * module, no hardware or models, half price, with the "jammer" program as
 * a rare line that is always out. Programs for sale include "scanner"
 * (scan, 120) and "jammer" (jamTrace, 200).
 */
function game(balance = 1000) {
  const state: GameState = syncWithContent(
    createGame({ seed: 4, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: balance }),
    content,
  );
  state.knownServers = content.servers.map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const login = (serverId: string, user: string) => {
    ok({ type: 'connect', serverId });
    const id = state.connections.at(-1)!.id;
    ok({ type: 'login', connectionId: id, user });
    return id;
  };
  return { state, act, ok, refused, login };
}

describe('Scanner', () => {
  it('reads a known server’s security after it runs', () => {
    const h = game();
    h.state.player.programs.push('scanner');
    expect(h.state.scanned).not.toContain('corp');
    h.ok({ type: 'scanServer', serverId: 'corp' });
    // The scan is a home task that takes time; run the clock until it finishes.
    tick(h.state, 60_000, content);
    expect(h.state.scanned).toContain('corp');
  });

  it('needs the program, a known address, and refuses a repeat', () => {
    const h = game();
    h.refused({ type: 'scanServer', serverId: 'corp' }, /do not own/);
    h.state.player.programs.push('scanner');
    h.state.knownServers = ['gateway', 'corp'];
    h.refused({ type: 'scanServer', serverId: 'vault' }, /address/);
    h.ok({ type: 'scanServer', serverId: 'corp' });
    tick(h.state, 60_000, content);
    h.refused({ type: 'scanServer', serverId: 'corp' }, /already scanned/);
  });
});

/** A connection with a trace already running, for the jammer tests. */
function traced(state: GameState): Connection {
  const connection: Connection = {
    id: 'c1',
    serverId: 'corp',
    route: [],
    user: 'admin',
    role: 'admin',
    openedAtMs: 0,
    bypassed: { proxy: false, firewall: false },
    trace: { status: 'active', graceMs: 0, elapsedMs: 0, hopMs: [20_000] },
    reroutes: 0,
    monitor: { blindMs: 0, used: false, echo: null },
  };
  state.connections.push(connection);
  return connection;
}

describe('Trace Jammer', () => {
  it('freezes a running trace, then lets it move again, once per connection', () => {
    const h = game();
    h.state.player.programs.push('jammer');
    const connection = traced(h.state);
    expect(jamTrace(h.state, content, 'c1')).toBeNull();
    // testRules freeze: 10s for a version 1 jammer.
    expect(connection.trace.frozenMs).toBe(10_000);
    expect(traceHeld(h.state, content, connection)).toBe(true);
    // Frozen: the trace stands still.
    expect(advanceTrace(connection.trace, 6_000)).toBe(false);
    expect(connection.trace.elapsedMs).toBe(0);
    expect(connection.trace.frozenMs).toBe(4_000);
    // Thaws mid-tick: the leftover counts towards the trace.
    expect(advanceTrace(connection.trace, 9_000)).toBe(false);
    expect(connection.trace.elapsedMs).toBe(5_000);
    // It only works once on a connection.
    expect(jamTrace(h.state, content, 'c1')).toMatch(/once/);
  });

  it('needs the program and a running trace', () => {
    const h = game();
    const connection = traced(h.state);
    expect(jamTrace(h.state, content, 'c1')).toMatch(/do not own/);
    h.state.player.programs.push('jammer');
    connection.trace.status = 'none';
    expect(jamTrace(h.state, content, 'c1')).toMatch(/no trace/);
  });
});

describe('Trace sensor', () => {
  it('lets you read a trace without a Trace Tracker program', () => {
    const h = game(3000);
    // The stock player owns a Trace Tracker; set it aside to isolate the sensor.
    h.state.player.programs = h.state.player.programs.filter((id) => id !== 'tracker');
    expect(canReadTrace(h.state, content)).toBe(false);
    const id = h.login('hidden', 'member');
    h.ok({ type: 'buyHardware', connectionId: id, partId: 'sensor-1' });
    expect(h.state.player.hardware.sensor).toBe(1);
    expect(canReadTrace(h.state, content)).toBe(true);
  });
});

describe('Parallel module', () => {
  it('a built program with the Offload trait does not take a run slot', () => {
    const h = game();
    h.state.player.programs.push('scanner');
    // A crafted copier with the parallel trait.
    h.state.player.builds.push({ id: 'bpar', base: 'copier', modules: [{ id: 'offload', grade: 1 }] });
    h.state.player.programs.push('bpar');
    const slot = (programId: string) => ({ id: `t-${programId}`, programId, connectionId: null, target: { kind: 'decrypt' as const, file: 'x' }, progressMs: 0, durationMs: 1000 });
    const newScan: TaskTarget = { kind: 'scan', serverId: 'corp' };
    // Three ordinary programs fill the gateway's three slots.
    h.state.tasks = [slot('scanner'), slot('copier'), slot('deleter')];
    expect(checkTask(h.state, content, null, newScan).ok).toBe(false);
    // Swap one for the Offload build: it runs off to the side, freeing a slot.
    h.state.tasks = [slot('bpar'), slot('copier'), slot('deleter')];
    expect(checkTask(h.state, content, null, newScan).ok).toBe(true);
  });
});

describe('Shops', () => {
  it('a specialist shop stocks its own shelf at its own price', () => {
    const h = game(1000);
    const id = h.login('bazaar', 'guest');
    // Scanner is a staple here, at half price (120 -> 60).
    h.ok({ type: 'buyProgram', connectionId: id, programId: 'scanner' });
    expect(h.state.player.balance).toBe(940);
    expect(h.state.player.programs).toContain('scanner');
    // The jammer is a rare line, always out here, also half price (200 -> 100).
    h.ok({ type: 'buyProgram', connectionId: id, programId: 'jammer' });
    expect(h.state.player.balance).toBe(840);
    // A password breaker is not on this shelf, and it sells no hardware.
    h.refused({ type: 'buyProgram', connectionId: id, programId: 'breaker-2' }, /does not stock/);
    h.refused({ type: 'buyHardware', connectionId: id, partId: 'cpu-2' }, /does not stock/);
  });

  it('the general store sells everything at list price', () => {
    const h = game(3000);
    const id = h.login('hidden', 'member');
    h.ok({ type: 'buyProgram', connectionId: id, programId: 'breaker-2' });
    expect(h.state.player.balance).toBe(2940);
  });
});

describe('Shop shelves and gear', () => {
  const server = (shop: Record<string, unknown>) => ({ ...content.servers.find((item) => item.id === 'hidden')!, shop: { programs: true, hardware: true, modules: true, models: true, priceFactor: 1, ...shop } });

  it('a shop can cap versions, tiers and grades, leave programs out, and limit hardware to some slots', () => {
    const h = game();
    const shop = server({ maxVersion: 1, maxTier: 1, maxGrade: 1, excludePrograms: ['scanner'], hardwareSlots: ['cpu'] }) as never;
    const find = (id: string) => content.programs.find((program) => program.id === id)!;
    expect(sellsProgram(h.state, shop, find('breaker-2'))).toBe(false);
    expect(sellsProgram(h.state, shop, find('scanner'))).toBe(false);
    expect(sellsProgram(h.state, shop, find('decompiler'))).toBe(true);
    expect(sellsHardware(h.state, shop, content.hardware.find((part) => part.id === 'cpu-1')!)).toBe(true);
    expect(sellsHardware(h.state, shop, content.hardware.find((part) => part.id === 'cpu-2')!)).toBe(false);
    expect(sellsHardware(h.state, shop, content.hardware.find((part) => part.id === 'modem-1')!)).toBe(false);
    const module = content.modules[0]!;
    expect(sellsModule(h.state, shop, module, 1)).toBe(true);
    expect(sellsModule(h.state, shop, module, 2)).toBe(false);
  });

  it('a shop that only sells posts no contracts', () => {
    expect(sellsOnly(server({ contracts: false }) as never)).toBe(true);
    expect(sellsOnly(server({}) as never)).toBe(false);
  });

  it('a cooler speeds the processor up on top of its own speed', () => {
    const h = game();
    expect(cpuSpeed(h.state, content)).toBe(1);
    h.state.player.hardware.cooling = 1;
    expect(cpuSpeed(h.state, content)).toBe(1.5);
    h.state.player.hardware.cpu = 2;
    expect(cpuSpeed(h.state, content)).toBe(3);
  });
});
