import { describe, expect, it } from 'vitest';
import { contracts, findPage, gameInfo, mail, programs, servers, sites, tuning } from './index';
import { parseSites } from './sites';
import { ContentError, MAIL_KEYS, checkContent, parseContracts, parseGameInfo, parseMail, parsePrograms, parseServers, parseTuning } from './schema';

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

describe('the in-game internet', () => {
  it('has a start page on each network, and every link leads to a page', () => {
    expect(findPage(sites, 'web', 'start.lumen/')).toBeDefined();
    expect(findPage(sites, 'dark', 'index.veil/')).toBeDefined();
    // A dark page cannot be opened from the ordinary web.
    expect(findPage(sites, 'web', 'index.veil/')).toBeUndefined();
  });

  it('rejects a link that leads nowhere and a site without a front page', () => {
    const site = { id: 's', net: 'web', address: 'a.b', name: 'S', pages: [{ path: '/', title: 'T', blocks: [{ p: 'x' }] }] };
    expect(parseSites([site])).toHaveLength(1);
    expect(() => parseSites([{ ...site, pages: [{ path: '/', title: 'T', blocks: [{ links: [{ text: 'x', to: 'no.where/' }] }] }] }])).toThrow(ContentError);
    expect(() => parseSites([{ ...site, pages: [{ path: '/x', title: 'T', blocks: [] }] }])).toThrow(ContentError);
    expect(() => parseSites([site, site])).toThrow(ContentError);
  });
});

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
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', ratings: [{ min: 0, title: 'New' }], startingServers: ['nope'], startingPrograms: [] });
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
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', ratings: [{ min: 0, title: 'New' }], startingServers: [], startingPrograms: [] });
    expect(() => checkContent(info, locked, programs)).toThrow(/no admin account/);
  });

  it('reject a starting program that does not exist', () => {
    const info = parseGameInfo({ title: 'T', defaultHandle: 'H', currencySuffix: 'c', ratings: [{ min: 0, title: 'New' }], startingServers: [], startingPrograms: ['nope'] });
    expect(() => checkContent(info, servers, programs)).toThrow(ContentError);
  });

  it('reject an unknown kind of program and a repeated id', () => {
    const good = { id: 'p', name: 'P', short: 'P', kind: 'copyFile', version: 1, baseSeconds: 1, secondsPerGq: 0, price: 0, sizeGq: 1, blurb: 'b' };
    expect(parsePrograms([good])).toHaveLength(1);
    expect(() => parsePrograms([{ ...good, kind: 'magic' }])).toThrow(ContentError);
    expect(() => parsePrograms([good, good])).toThrow(ContentError);
  });

  it('ship one program for every job, and no layer the starting programs cannot beat', () => {
    for (const kind of ['breakPassword', 'bypassProxy', 'bypassFirewall', 'bypassMonitor', 'decrypt', 'copyFile', 'deleteFile', 'deleteLog', 'traceTracker']) {
      expect(programs.some((program) => program.kind === kind), kind).toBe(true);
    }
    for (const server of servers) {
      for (const level of [server.security.password, server.security.proxy, server.security.firewall]) {
        expect(level, server.id).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('contract checks', () => {
  const job = {
    id: 'j',
    title: 'T',
    client: 'C',
    targetId: 'ashgrove-poly',
    pay: 100,
    rating: 1,
    minRating: 0,
    summary: 's',
    brief: 'b',
    objective: { kind: 'steal', file: 'fee_waivers.dat' },
  };
  const check = (change: object) => () => checkContent(gameInfo, servers, programs, parseContracts([{ ...job, ...change }]));

  it('accept a job against a real file or record', () => {
    expect(check({})).not.toThrow();
    expect(check({ objective: { kind: 'record', key: '20322410', column: 'Standing', value: 'Good' } })).not.toThrow();
  });

  it('reject a target, file, record or column that does not exist', () => {
    expect(check({ targetId: 'nowhere' })).toThrow(/not a server/);
    expect(check({ objective: { kind: 'destroy', file: 'nope.dat' } })).toThrow(/no file/);
    expect(check({ objective: { kind: 'record', key: '1', column: 'Standing', value: 'Good' } })).toThrow(/no record/);
    expect(check({ objective: { kind: 'record', key: '20322410', column: 'Shoe size', value: '9' } })).toThrow(/column/);
    // The first column identifies the row, so it can't be the thing that changes.
    expect(check({ objective: { kind: 'record', key: '20322410', column: 'Student ID', value: '9' } })).toThrow(/column/);
  });

  it('reject an unknown kind of job, a missing brief and a repeated id', () => {
    expect(() => parseContracts([{ ...job, objective: { kind: 'bribe' } }])).toThrow(ContentError);
    expect(() => parseContracts([{ ...job, brief: '' }])).toThrow(ContentError);
    expect(() => parseContracts([job, job])).toThrow(ContentError);
  });

  it('reject a mail file with a message missing', () => {
    const { welcome: _welcome, ...rest } = mail;
    expect(() => parseMail(rest)).toThrow(/welcome/);
    expect(Object.keys(parseMail(mail)).sort()).toEqual([...MAIL_KEYS].sort());
  });

  it('reject rating titles that do not start at 0 or go up', () => {
    const info = { title: 'T', defaultHandle: 'H', currencySuffix: 'c', startingServers: [], startingPrograms: [] };
    expect(() => parseGameInfo({ ...info, ratings: [{ min: 1, title: 'A' }] })).toThrow(ContentError);
    expect(() => parseGameInfo({ ...info, ratings: [{ min: 0, title: 'A' }, { min: 0, title: 'B' }] })).toThrow(ContentError);
  });
});

describe('shipped contracts', () => {
  it('can be started by a new player and reach every job by doing them in order', () => {
    expect(contracts.some((contract) => contract.minRating === 0)).toBe(true);
    let rating = 0;
    for (const contract of [...contracts].sort((a, b) => a.minRating - b.minRating)) {
      expect(contract.minRating, contract.id).toBeLessThanOrEqual(rating);
      rating += contract.rating;
    }
  });

  it('only need layers a program on sale or owned at the start can beat', () => {
    const best = (kind: string) => Math.max(0, ...programs.filter((p) => p.kind === kind && (p.price > 0 || gameInfo.startingPrograms.includes(p.id))).map((p) => p.version));
    for (const contract of contracts) {
      const security = servers.find((server) => server.id === contract.targetId)!.security;
      expect(security.password - best('breakPassword'), contract.id).toBeLessThanOrEqual(2);
      if (contract.objective.kind === 'record') expect(security.proxy - best('bypassProxy'), contract.id).toBeLessThanOrEqual(2);
      else expect(security.firewall - best('bypassFirewall'), contract.id).toBeLessThanOrEqual(2);
    }
  });

  it('only use placeholders the rules fill in', () => {
    const known = ['handle', 'client', 'title', 'pay', 'target', 'fine', 'hours', 'lines'];
    for (const letter of Object.values(mail)) {
      for (const [, name] of `${letter.from} ${letter.subject} ${letter.body}`.matchAll(/\{(\w+)\}/g)) {
        expect(known).toContain(name);
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
