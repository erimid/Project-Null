import { describe, expect, it } from 'vitest';
import { gameInfo, servers, tuning } from './index';
import { ContentError, checkContent, parseGameInfo, parseServers, parseTuning } from './schema';

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
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', startingServers: ['nope'] });
    expect(() => checkContent(info, servers)).toThrow(ContentError);
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
