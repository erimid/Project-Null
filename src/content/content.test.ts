import { describe, expect, it } from 'vitest';
import { companies, contracts, findPage, gameInfo, hardware, mail, models, modules, people, programs, rivals, servers, sites, skills, story, tuning } from './index';
import companiesJson from './companies.json';
import { parseCompanies } from './companies';
import { parseHardware } from './hardware';
import { checkPeople, parsePeople } from './people';
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
    expect(count('board')).toBeGreaterThanOrEqual(1);
    expect(servers.filter((s) => s.kind === 'board' && s.shop?.contracts !== false)).toHaveLength(1);
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
      // An unlisted server has to be one somebody can be talked into giving the address of,
      // an enemy hacker's home (a won counter-trace puts it in the address book), or a
      // contract's target (taking the contract reveals the address).
      const told = people.asks.some((ask) => ask.reward.kind === 'address' && ask.reward.serverId === server.id);
      const rivalHome = rivals.some((rival) => rival.homeId === server.id);
      const contractTarget = contracts.some((contract) => contract.targetId === server.id || (contract.stages ?? []).some((stage) => stage.targetId === server.id));
      expect(server.listed || told || rivalHome || contractTarget || gameInfo.startingServers.includes(server.id), server.id).toBe(true);
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
      // A layer run from another server is beaten by holding that server, not by a program.
      const beatable = (['password', 'proxy', 'firewall'] as const).filter((layer) => server.link?.layer !== layer);
      for (const layer of beatable) {
        expect(server.security[layer], server.id).toBeLessThanOrEqual(3);
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
  it('can be started by a new player, and each one is only a few standing jobs past the one before', () => {
    expect(contracts.some((contract) => contract.minRating === 0)).toBe(true);
    let rating = 0;
    for (const contract of [...contracts].sort((a, b) => a.minRating - b.minRating)) {
      // The gap is made up with standing jobs. More than a handful in a row would be a grind.
      expect(contract.minRating - rating, contract.id).toBeLessThanOrEqual(4);
      rating = Math.max(rating, contract.minRating) + contract.rating;
    }
    // The top title takes all of them and then some.
    expect(gameInfo.ratings[gameInfo.ratings.length - 1]!.min).toBeGreaterThan(rating - 4);
  });

  it('only need layers a program on sale or owned at the start can beat', () => {
    const best = (kind: string) => Math.max(0, ...programs.filter((p) => p.kind === kind && (p.price > 0 || gameInfo.startingPrograms.includes(p.id))).map((p) => p.version));
    for (const contract of contracts) {
      const security = servers.find((server) => server.id === contract.targetId)!.security;
      expect(security.password - best('breakPassword'), contract.id).toBeLessThanOrEqual(2);
      if (contract.objective.kind === 'record') expect(security.proxy - best('bypassProxy'), contract.id).toBeLessThanOrEqual(2);
      else if (servers.find((server) => server.id === contract.targetId)!.link?.layer !== 'firewall') {
        expect(security.firewall - best('bypassFirewall'), contract.id).toBeLessThanOrEqual(2);
      }
    }
  });

  it('only use placeholders the rules fill in', () => {
    const known = ['handle', 'client', 'title', 'pay', 'target', 'fine', 'hours', 'lines', 'name', 'label', 'model', 'part', 'now', 'step', 'of', 'brief', 'who', 'style', 'home', 'address', 'loss', 'taunt'];
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

describe('people checks', () => {
  const copy = () => JSON.parse(JSON.stringify(people)) as { people: object[]; facts: object[]; asks: Record<string, unknown>[] };

  it('accept the shipped people, with every ask answerable by someone the player can come across', () => {
    expect(() => checkPeople(people, servers, tuning.phishMaxDetails)).not.toThrow();
    expect(people.asks.length).toBeGreaterThan(0);
  });

  it('reject an ask that names a missing person, fact, account or server', () => {
    const broken = (change: object) => () => {
      const data = copy();
      data.asks[0] = { ...data.asks[0], ...change };
      checkPeople(parsePeople(data), servers, tuning.phishMaxDetails);
    };
    expect(broken({ senderId: 'nobody' })).toThrow(/not in people/);
    expect(broken({ needs: ['nothing'] })).toThrow(/not a fact/);
    expect(broken({ reward: { kind: 'password', serverId: 'polar-mesh', user: 'root' } })).toThrow(/no account/);
    expect(broken({ reward: { kind: 'address', serverId: 'nowhere' } })).toThrow(/does not exist/);
    expect(broken({ reward: { kind: 'money' } })).toThrow(ContentError);
  });

  it('reject a detail from a file that does not exist', () => {
    const data = copy();
    data.facts[0] = { ...data.facts[0], source: { serverId: 'polar-mesh', file: 'nope.txt' } };
    expect(() => checkPeople(parsePeople(data), servers, tuning.phishMaxDetails)).toThrow(/no file/);
  });
});

describe('hardware', () => {
  const cpu = (tier: number, price: number) => ({ id: `cpu-${tier}`, slot: 'cpu', tier, name: 'C', blurb: 'b', price, speed: tier, programs: 3 });
  const stock = [
    cpu(1, 0),
    { id: 's', slot: 'storage', tier: 1, name: 'S', blurb: 'b', price: 0, storageGb: 40 },
    { id: 'm', slot: 'modem', tier: 1, name: 'M', blurb: 'b', price: 0, fileSpeed: 1 },
    { id: 'p', slot: 'ports', tier: 1, name: 'P', blurb: 'b', price: 0, connections: 1 },
  ];

  it('ships a stock part for every core slot, free, and racks that host real models', () => {
    for (const slot of ['cpu', 'storage', 'modem', 'ports'] as const) {
      expect(hardware.find((part) => part.slot === slot && part.tier === 1)?.price, slot).toBe(0);
    }
    for (const part of hardware.filter((item) => item.slot === 'rack')) {
      expect(models.some((model) => model.id === part.model)).toBe(true);
    }
  });

  it('accepts a minimal set and rejects gaps, paid stock parts, missing values and unknown models', () => {
    expect(parseHardware(stock, [])).toHaveLength(4);
    expect(() => parseHardware([...stock, cpu(3, 10)], [])).toThrow(/no gaps/);
    expect(() => parseHardware([cpu(1, 5), ...stock.slice(1)], [])).toThrow(/price must be 0/);
    expect(() => parseHardware([{ ...cpu(1, 0), programs: undefined }, ...stock.slice(1)], [])).toThrow(/programs/);
    expect(() => parseHardware(stock.slice(1), [])).toThrow(/tier 1/);
    const rack = { id: 'r', slot: 'rack', tier: 1, name: 'R', blurb: 'b', price: 9, sizeGb: 4, model: 'ghost' };
    expect(() => parseHardware([...stock, rack], ['magpie'])).toThrow(/models.json/);
    expect(parseHardware([...stock, { ...rack, model: 'magpie' }], ['magpie'])).toHaveLength(5);
  });
});

describe('layers run from another server', () => {
  const info = { ...gameInfo, startingServers: [], startingPrograms: [] };
  const target = (link: unknown, security = { password: 0, proxy: 0, firewall: 5, monitor: 0 }) =>
    parseServers([valid, { ...relay, accounts: [{ user: 'root', role: 'admin', name: 'R' }] }, { ...relay, id: 't', address: '10.0.0.10', security, link }]);

  it('accepts a link to another server with an admin login', () => {
    expect(() => checkContent(info, target({ serverId: 'r', layer: 'firewall' }), [])).not.toThrow();
  });

  it('rejects unknown layers, unknown servers, itself, and a layer the server does not have', () => {
    expect(() => target({ serverId: 'r', layer: 'proxy' })).toThrow(/link layer/);
    expect(() => checkContent(info, target({ serverId: 'nope', layer: 'firewall' }), [])).toThrow(/not another server/);
    expect(() => checkContent(info, target({ serverId: 't', layer: 'firewall' }), [])).toThrow(/not another server/);
    expect(() => checkContent(info, target({ serverId: 'r', layer: 'monitor' }), [])).toThrow(/has none/);
  });
});

describe('company pools', () => {
  it('ship enough stems for every company and at least one sector with records', () => {
    expect(companies.stems.length).toBeGreaterThanOrEqual(companies.count);
    expect(companies.sectors.some((sector) => sector.records)).toBe(true);
  });

  it('reject a sector with no admin file, a bad network prefix, and too few stems', () => {
    const good = JSON.parse(JSON.stringify(companiesJson));
    expect(() => parseCompanies(good)).not.toThrow();
    const noAdmin = JSON.parse(JSON.stringify(good));
    noAdmin.sectors[0].files = [{ name: 'a.txt', sizeGb: [1, 1], access: 'guest', text: 'x' }];
    expect(() => parseCompanies(noAdmin)).toThrow(/admin file/);
    const badNet = JSON.parse(JSON.stringify(good));
    badNet.cities[0].net = '300.1';
    expect(() => parseCompanies(badNet)).toThrow(/net/);
    expect(() => parseCompanies({ ...good, count: good.stems.length + 1 })).toThrow(/stems/);
  });
});

describe('the catalogue', () => {
  it('is big: about 40 programs, 45 parts, 12 modules, 7 models and a deep skill tree', () => {
    expect(programs.length).toBeGreaterThanOrEqual(40);
    expect(hardware.length).toBeGreaterThanOrEqual(44);
    expect(modules.length).toBeGreaterThanOrEqual(12);
    expect(models.length).toBeGreaterThanOrEqual(7);
    expect(skills.length).toBeGreaterThanOrEqual(25);
  });

  it('is on sale somewhere: every priced program, part and module grade is on some shop’s shelf, as a staple or a rare line', () => {
    const shops = servers.filter((server) => server.kind === 'board');
    const rare = (kind: string, id: string, grade?: number) =>
      shops.some((server) => server.shop?.rare?.some((line) => line.kind === kind && line.id === id && (grade === undefined || line.grade === undefined || line.grade === grade)));
    for (const program of programs.filter((item) => item.price > 0)) {
      const sold = shops.some((server) => {
        const shop = server.shop!;
        return (
          shop.programs &&
          (!shop.programKinds || shop.programKinds.includes(program.kind)) &&
          program.version <= (shop.maxVersion ?? Infinity) &&
          !shop.excludePrograms?.includes(program.id)
        );
      });
      expect(sold || rare('program', program.id), program.id).toBe(true);
    }
    for (const part of hardware.filter((item) => item.price > 0)) {
      const sold = shops.some((server) => {
        const shop = server.shop!;
        return shop.hardware && part.tier <= (shop.maxTier ?? Infinity) && (!shop.hardwareSlots || shop.hardwareSlots.includes(part.slot));
      });
      expect(sold || rare('hardware', part.id), part.id).toBe(true);
    }
    for (const module of modules) {
      for (let grade = 1; grade <= module.grades.length; grade++) {
        const sold = shops.some((server) => server.shop!.modules && grade <= (server.shop!.maxGrade ?? Infinity));
        expect(sold || rare('module', module.id, grade), `${module.id} ${grade}`).toBe(true);
      }
    }
  });

  it('has more than one shop, and only one of them posts contracts', () => {
    const boards = servers.filter((server) => server.kind === 'board');
    expect(boards.length).toBeGreaterThanOrEqual(4);
    expect(boards.filter((server) => server.shop?.contracts !== false)).toHaveLength(1);
  });
});

describe('Act 1 and the written jobs', () => {
  it('has about fifteen written multi-stage contracts for the middle and the top of the ladder', () => {
    const staged = contracts.filter((contract) => !contract.story && (contract.stages?.length ?? 0) > 0);
    expect(staged.length).toBeGreaterThanOrEqual(15);
    expect(Math.min(...staged.map((contract) => contract.minRating))).toBeGreaterThanOrEqual(8);
    expect(Math.max(...staged.map((contract) => contract.minRating))).toBeGreaterThanOrEqual(40);
  });

  it('has many openable files sorted into server folders', () => {
    const inFolders = servers.flatMap((server) => server.files.filter((file) => file.folder !== undefined && file.content !== undefined));
    expect(inFolders.length).toBeGreaterThanOrEqual(35);
  });

  it('never says the secret name outside the redacted last file', () => {
    const text = JSON.stringify([servers, contracts, mail, story, programs, sites]).replace(/PROJECT_N████\.dat/g, '').replace(/P R O J E C T +N/g, '');
    expect(text).not.toMatch(/project null/i);
  });
});
