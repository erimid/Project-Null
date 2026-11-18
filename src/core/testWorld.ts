/** A tiny made-up world for unit tests, so tests don't depend on the real data files. */
import type { ServerDef } from '../content/schema';
import type { Content } from './world';

const base = {
  owner: 'Test Owner',
  city: 'Testville',
  country: 'Testland',
  lat: 0,
  lon: 0,
  blurb: 'A test server.',
  banner: ['TEST'],
  logs: [],
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
    records: { title: 'People', columns: ['Id', 'Name'], rows: [['1', 'Ann'], ['2', 'Bo']] },
  },
  { ...base, id: 'hidden', name: 'Unlisted', kind: 'board', hostname: 'H', address: '10.0.0.6', listed: false, accounts: [{ user: 'member', role: 'guest', name: 'Member' }], files: [] },
];

export const content: Content = { servers: testServers, startingServers: ['directory'] };
