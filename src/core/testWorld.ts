/** A tiny made-up world for unit tests, so tests don't depend on the real data files. */
import type { ServerDef } from '../content/schema';
import type { ContractDef, MailDef, MailKey, ProgramDef } from '../content/schema';
import type { Content, Rules } from './world';

const base = {
  owner: 'Test Owner',
  city: 'Testville',
  country: 'Testland',
  lat: 0,
  lon: 0,
  blurb: 'A test server.',
  banner: ['TEST'],
  logs: [],
  security: { password: 0, proxy: 0, firewall: 0, monitor: 0 },
  traceSecondsPerHop: 10,
  relayDelay: 1,
};

export const testServers: ServerDef[] = [
  { ...base, id: 'gateway', name: 'Home Gateway', kind: 'gateway', hostname: 'localhost', address: '10.0.0.1', listed: false, accounts: [], files: [] },
  {
    ...base,
    id: 'directory',
    name: 'Directory',
    kind: 'directory',
    hostname: 'DIR',
    address: '10.0.0.2',
    listed: true,
    accounts: [{ user: 'guest', role: 'guest', name: 'Public' }],
    files: [{ name: 'readme.txt', sizeGq: 1, access: 'guest' }],
    logs: [
      { minutesAgo: 5, text: 'later entry' },
      { minutesAgo: 60, text: 'earlier entry' },
    ],
  },
  {
    ...base,
    id: 'relay-a',
    name: 'Relay A',
    kind: 'relay',
    hostname: 'RA',
    address: '10.0.0.3',
    listed: true,
    accounts: [
      { user: 'guest', role: 'guest', name: 'Public' },
      { user: 'root', role: 'admin', name: 'Admin' },
    ],
    files: [],
    relayDelay: 2,
  },
  { ...base, id: 'relay-b', name: 'Relay B', kind: 'relay', hostname: 'RB', address: '10.0.0.4', listed: true, accounts: [{ user: 'guest', role: 'guest', name: 'Public' }], files: [] },
  {
    ...base,
    id: 'corp',
    name: 'Test Corp',
    kind: 'company',
    hostname: 'CORP-1',
    address: '10.0.0.5',
    listed: true,
    accounts: [{ user: 'admin', role: 'admin', name: 'A. Admin' }],
    files: [{ name: 'secret.dat', sizeGq: 5, access: 'admin' }],
    security: { password: 1, proxy: 1, firewall: 1, monitor: 1 },
    records: { title: 'People', columns: ['Id', 'Name'], rows: [['1', 'Ann'], ['2', 'Bo']] },
  },
  { ...base, id: 'hidden', name: 'Unlisted', kind: 'board', hostname: 'H', address: '10.0.0.6', listed: false, accounts: [{ user: 'member', role: 'guest', name: 'Member' }], files: [] },
];

const program = (id: string, kind: ProgramDef['kind'], baseSeconds: number, secondsPerGq = 0): ProgramDef => ({
  id,
  name: id,
  short: id,
  kind,
  version: 1,
  baseSeconds,
  secondsPerGq,
  price: 0,
  blurb: 'A test program.',
});

export const testPrograms: ProgramDef[] = [
  program('breaker', 'breakPassword', 10),
  program('proxy', 'bypassProxy', 6),
  program('firewall', 'bypassFirewall', 6),
  program('copier', 'copyFile', 2, 1),
  program('deleter', 'deleteFile', 2, 0.5),
  program('logs', 'deleteLog', 3),
  program('tracker', 'traceTracker', 0),
];

export const testRules: Rules = {
  gameMinutesPerRealSecond: 1,
  monitorGraceSeconds: [20, 8, 3],
  maxRunningPrograms: 3,
  storageGq: 20,
  directTraceFactor: 0.5,
  lieLowHours: 6,
  finePerSecurityLevel: 20,
  caughtRatingLoss: 1,
  maxReroutes: 2,
  reviewHours: 3,
  reviewFineFactor: 0.5,
  ringToleranceDegrees: 20,
  ringMissSeconds: 2,
};

/** Two extra programs that are only for sale, never owned at the start. */
export const shopPrograms: ProgramDef[] = [
  { ...program('breaker-2', 'breakPassword', 10), version: 2, price: 60 },
  { ...program('gold-plated', 'copyFile', 1), price: 5000 },
];

export const testContracts: ContractDef[] = [
  { id: 'steal', title: 'Steal it', client: 'Client S', targetId: 'corp', pay: 300, rating: 1, minRating: 0, summary: 's', brief: 'b', objective: { kind: 'steal', file: 'secret.dat' } },
  { id: 'destroy', title: 'Destroy it', client: 'Client D', targetId: 'corp', pay: 400, rating: 2, minRating: 0, summary: 's', brief: 'b', objective: { kind: 'destroy', file: 'secret.dat' } },
  { id: 'record', title: 'Change it', client: 'Client R', targetId: 'corp', pay: 500, rating: 1, minRating: 1, summary: 's', brief: 'b', objective: { kind: 'record', key: '2', column: 'Name', value: 'Bob' } },
  { id: 'elite', title: 'Hard one', client: 'Client E', targetId: 'directory', pay: 900, rating: 1, minRating: 50, summary: 's', brief: 'b', objective: { kind: 'steal', file: 'readme.txt' } },
];

const letter = (key: string, extra = ''): MailDef => ({ from: 'Fixer', subject: key, body: `${key} for {handle}${extra}` });
export const testMail: Record<MailKey, MailDef> = {
  welcome: letter('welcome'),
  firstAccept: letter('firstAccept'),
  firstDelivery: letter('firstDelivery'),
  paid: { from: '{client}', subject: 'Paid: {title}', body: '{pay}' },
  contractFailed: { from: '{client}', subject: 'Withdrawn: {title}', body: '{target}' },
  caught: { from: 'Fixer', subject: 'Traced by {target}', body: 'fine {fine}, {hours} hours' },
  review: { from: 'Fixer', subject: 'Logs read at {target}', body: '{lines}, fine {fine}' },
};

export const content: Content = {
  servers: testServers,
  startingServers: ['directory'],
  programs: [...testPrograms, ...shopPrograms],
  startingPrograms: testPrograms.map((item) => item.id),
  contracts: testContracts,
  mail: testMail,
  rules: testRules,
};
