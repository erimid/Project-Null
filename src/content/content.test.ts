import { describe, expect, it } from 'vitest';
import { gameInfo, servers, tuning } from './index';
import { ContentError, parseServers, parseTuning } from './schema';

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
};

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
    expect(parseServers([valid])).toHaveLength(1);
  });

  it.each([
    ['a duplicate id', [valid, { ...valid, address: '10.0.0.2', kind: 'relay' }]],
    ['a duplicate address', [valid, { ...valid, id: 'b', kind: 'relay' }]],
    ['an unknown kind', [{ ...valid, kind: 'spaceship' }]],
    ['a latitude off the globe', [{ ...valid, lat: 91 }]],
    ['a longitude off the globe', [{ ...valid, lon: -181 }]],
    ['a malformed address', [{ ...valid, address: '10.0.0.999' }]],
    ['a missing name', [{ ...valid, name: '' }]],
    ['no gateway', [{ ...valid, kind: 'relay' }]],
    ['two gateways', [valid, { ...valid, id: 'b', address: '10.0.0.2' }]],
    ['something that is not a list', { servers: [] }],
  ])('reject %s', (_label, data) => {
    expect(() => parseServers(data)).toThrow(ContentError);
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
