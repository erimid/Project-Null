import { describe, expect, it } from 'vitest';
import { gameInfo, programs, servers, tuning } from './index';
import { ContentError, checkContent, parseGameInfo, parsePrograms, parseServers, parseTuning } from './schema';

const valid = {
  id: 'a',
  name: 'A',
  kind: 'gateway',
  owner: 'You',
  address: '10.0.0.1',
  city: 'X',
  country: 'Y',
  lat: 0,
  lon: 0,
  blurb: 'b',
  hostname: 'H',
  listed: false,
  banner: ['Hello'],
  accounts: [],
  files: [{ name: 'f.dat', sizeGq: 1, access: 'guest' }],
  logs: [{ minutesAgo: 5, text: 'x' }],
  security: { password: 0, proxy: 0, firewall: 0, monitor: 0 },
  traceSecondsPerHop: 10,
  relayDelay: 1,
};
const relay = { ...valid, id: 'r', address: '10.0.0.9', kind: 'relay', accounts: [{ user: 'guest', role: 'guest', name: 'G' }] };

describe('shipped data files', () => {
  it('load without errors', () => {
    expect(gameInfo.title).toBe('Project Null');
    expect(tuning.startingBalance).toBeGreaterThan(0);
    expect(servers.length).toBeGreaterThanOrEqual(10);
  });

  it('include the server kinds the first slice needs', () => {
    const count = (kind: string) => servers.filter((s) => s.kind === kind).length;
    expect(count('gateway')).toBe(1);
    expect(count('directory')).toBe(1);
    expect(count('board')).toBe(1);
    expect(count('relay')).toBeGreaterThanOrEqual(3);
    expect(count('company')).toBeGreaterThanOrEqual(4);
  });
});

describe('server checks', () => {
  it('accept a valid list', () => {
    expect(parseServers([valid, relay])).toHaveLength(2);
  });

  it('accept a records table', () => {
    const records = { title: 'T', columns: ['A', 'B'], rows: [['1', 'x'], ['2', 'y']] };
    expect(parseServers([{ ...valid, records }])[0]!.records).toEqual(records);
  });

  it.each([
    ['a duplicate id', [valid, { ...relay, id: 'a' }]],
    ['a duplicate address', [valid, { ...relay, address: '10.0.0.1' }]],
    ['a server nobody can log in to', [valid, { ...relay, accounts: [] }]],
    ['an unknown role', [valid, { ...relay, accounts: [{ user: 'x', role: 'king', name: 'X' }] }]],
    ['two accounts with the same login', [valid, { ...relay, accounts: [...relay.accounts, ...relay.accounts] }]],
    ['two files with the same name', [{ ...valid, files: [...valid.files, ...valid.files] }]],
    ['a file with no size', [{ ...valid, files: [{ name: 'x', access: 'guest' }] }]],
    ['a log with no text', [{ ...valid, logs: [{ minutesAgo: 1 }] }]],
    ['a missing listed flag', [{ ...valid, listed: undefined }]],
    ['a records row of the wrong width', [{ ...valid, records: { title: 'T', columns: ['A', 'B'], rows: [['1']] } }]],
    ['two records with the same key', [{ ...valid, records: { title: 'T', columns: ['A'], rows: [['1'], ['1']] } }]],
    ['an unknown kind', [{ ...valid, kind: 'spaceship' }]],
    ['a latitude off the globe', [{ ...valid, lat: 91 }]],
    ['a longitude off the globe', [{ ...valid, lon: -181 }]],
    ['a malformed address', [{ ...valid, address: '10.0.0.999' }]],
    ['a missing name', [{ ...valid, name: '' }]],
    ['no gateway', [relay]],
    ['two gateways', [valid, { ...valid, id: 'b', address: '10.0.0.2' }]],
    ['something that is not a list', { servers: [] }],
  ])('reject %s', (_label, data) => {
    expect(() => parseServers(data)).toThrow(ContentError);
  });
});

describe('shipped servers', () => {
  it('each have a login screen worth reading', () => {
    for (const server of servers.filter((s) => s.kind !== 'gateway')) {
      expect(server.banner.length, server.id).toBeGreaterThanOrEqual(2);
      expect(server.files.length, server.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('can all be reached: every server is a starting server or listed in the registry', () => {
    for (const server of servers.filter((s) => s.kind !== 'gateway')) {
      expect(server.listed || gameInfo.startingServers.includes(server.id), server.id).toBe(true);
    }
  });

  it('include a directory among the starting servers, so the rest can be found', () => {
    const starting = servers.filter((s) => gameInfo.startingServers.includes(s.id));
    expect(starting.some((s) => s.kind === 'directory')).toBe(true);
  });
});

describe('cross-file checks', () => {
  it('reject a starting server that does not exist', () => {
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', startingServers: ['nope'], startingPrograms: [] });
    expect(() => checkContent(info, servers, programs)).toThrow(ContentError);
  });
});

describe('security and program checks', () => {
  it('reject a security level that is out of range, and a missing trace time', () => {
    expect(() => parseServers([{ ...valid, security: { ...valid.security, proxy: 9 } }])).toThrow(ContentError);
    expect(() => parseServers([{ ...valid, security: { password: 1 } }])).toThrow(ContentError);
    expect(() => parseServers([{ ...valid, traceSecondsPerHop: undefined }])).toThrow(ContentError);
  });

  it('reject a password layer on a server with no administrator account', () => {
    const locked = parseServers([valid, { ...relay, security: { ...valid.security, password: 1 } }]);
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', startingServers: [], startingPrograms: [] });
    expect(() => checkContent(info, locked, programs)).toThrow(/no admin account/);
  });

  it('reject a starting program that does not exist', () => {
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', startingServers: [], startingPrograms: ['nope'] });
    expect(() => checkContent(info, servers, programs)).toThrow(ContentError);
  });

  it('reject an unknown kind of program and a repeated id', () => {
    const good = { id: 'p', name: 'P', short: 'P', kind: 'copyFile', version: 1, baseSeconds: 1, secondsPerGq: 0, blurb: 'b' };
    expect(parsePrograms([good])).toHaveLength(1);
    expect(() => parsePrograms([{ ...good, kind: 'magic' }])).toThrow(ContentError);
    expect(() => parsePrograms([good, good])).toThrow(ContentError);
  });

  it('ship one program for every job, and no layer the starting programs cannot beat', () => {
    for (const kind of ['breakPassword', 'bypassProxy', 'bypassFirewall', 'copyFile', 'deleteFile', 'deleteLog', 'traceTracker']) {
      expect(programs.some((program) => program.kind === kind), kind).toBe(true);
    }
    for (const server of servers) {
      for (const level of [server.security.password, server.security.proxy, server.security.firewall]) {
        expect(level, server.id).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('tuning checks', () => {
  it('reject a bad start date', () => {
    expect(() => parseTuning({ ...tuning, startDate: 'someday' })).toThrow(ContentError);
  });
  it('reject a negative starting balance', () => {
    expect(() => parseTuning({ ...tuning, startingBalance: -1 })).toThrow(ContentError);
  });
});
