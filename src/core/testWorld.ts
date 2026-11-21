/** A tiny made-up world for unit tests, so tests don't depend on the real data files. */
import type { ServerDef } from '../content/schema';
import type { ContractDef, MailDef, MailKey, ProgramDef } from '../content/schema';
import { NO_COMPANIES } from '../content/companies';
import type { HardwareDef } from '../content/hardware';
import type { SkillDef } from '../content/skills';
import type { ModuleDef } from '../content/modules';
import type { PeopleDef } from '../content/people';
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
  {
    ...base,
    id: 'vault',
    name: 'Test Vault',
    kind: 'company',
    hostname: 'VAULT',
    address: '10.0.0.7',
    listed: false,
    accounts: [{ user: 'admin', role: 'admin', name: 'V. Admin' }],
    files: [{ name: 'sealed.dat', sizeGq: 2, access: 'admin', encrypted: 1 }],
    // The monitor traces from the moment you connect.
    security: { password: 0, proxy: 0, firewall: 0, monitor: 3 },
  },
  // Two pairs of servers where one runs a layer of the other.
  { ...base, id: 'desk', name: 'Security Desk', kind: 'company', hostname: 'DESK', address: '10.0.0.8', listed: true, accounts: [{ user: 'guard', role: 'admin', name: 'Guard' }], files: [] },
  {
    ...base,
    id: 'tower',
    name: 'Watched Tower',
    kind: 'company',
    hostname: 'TOWER',
    address: '10.0.0.9',
    listed: true,
    accounts: [{ user: 'admin', role: 'admin', name: 'T. Admin' }],
    files: [{ name: 'plans.dat', sizeGq: 2, access: 'admin' }],
    // Traces from the moment you connect, unless the desk is held.
    security: { password: 0, proxy: 0, firewall: 0, monitor: 3 },
    link: { serverId: 'desk', layer: 'monitor' },
  },
  { ...base, id: 'gatehouse', name: 'Gatehouse', kind: 'company', hostname: 'GATE', address: '10.0.0.10', listed: true, accounts: [{ user: 'ops', role: 'admin', name: 'Ops' }], files: [] },
  {
    ...base,
    id: 'fort',
    name: 'Fort',
    kind: 'company',
    hostname: 'FORT',
    address: '10.0.0.11',
    listed: true,
    accounts: [{ user: 'admin', role: 'admin', name: 'F. Admin' }],
    files: [{ name: 'bundle.dat', sizeGq: 2, access: 'admin' }],
    security: { password: 0, proxy: 0, firewall: 5, monitor: 0 },
    link: { serverId: 'gatehouse', layer: 'firewall' },
  },
  { ...base, id: 'hidden', name: 'Unlisted', kind: 'board', hostname: 'H', address: '10.0.0.6', listed: false, accounts: [{ user: 'member', role: 'guest', name: 'Member' }], files: [] },
  {
    ...base,
    id: 'bazaar',
    name: 'Bazaar',
    kind: 'board',
    hostname: 'BZ',
    address: '10.0.0.13',
    listed: true,
    accounts: [{ user: 'guest', role: 'guest', name: 'Public' }],
    files: [],
    // A specialist shop: only Scanners as staple programs, every module, no hardware or models, half price, with the jammer as a rare line that is always out. It posts no contracts.
    shop: {
      contracts: false,
      programs: true,
      hardware: false,
      modules: true,
      models: false,
      programKinds: ['scan'],
      priceFactor: 0.5,
      rare: [{ kind: 'program', id: 'jammer', chance: 1 }],
    },
  },
];

/** A rival hacker's home server, for the raid tests. Not in the default world. */
export const rivalHome: ServerDef = {
  ...base,
  id: 'rival-home',
  name: 'Rival Rig',
  kind: 'company',
  hostname: 'RIVAL',
  address: '10.0.0.12',
  listed: false,
  accounts: [{ user: 'rival', role: 'admin', name: 'Rival' }],
  files: [
    { name: 'loot.dat', sizeGq: 2, access: 'admin' },
    { name: 'spare.mod', sizeGq: 1, access: 'admin' },
  ],
  security: { password: 2, proxy: 0, firewall: 2, monitor: 2 },
};

/** Two rivals for the raid tests: a thief and a vandal. */
export const testRivals = [
  { id: 'thief', handle: 'Thief', blurb: 'b', homeId: 'rival-home', relays: ['relay-a', 'relay-b'], level: 1, minRating: 4, style: 'thief' as const, taunt: 'ta' },
  { id: 'wrecker', handle: 'Wrecker', blurb: 'b', homeId: 'rival-home', relays: ['relay-a'], level: 2, minRating: 4, style: 'vandal' as const, taunt: 'tb' },
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
  sizeGq: 0,
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
  program('blinder', 'bypassMonitor', 4),
  program('decrypter', 'decrypt', 6, 1),
];

export const testRules: Rules = {
  gameMinutesPerRealSecond: 1,
  monitorGraceSeconds: [20, 8, 3],
  directTraceFactor: 0.5,
  sameCountryLegFactor: 1,
  borderLegFactor: 1,
  overseasLegFactor: 1,
  // Every relay counts in full in tests unless a test says otherwise.
  relayFullSteps: 99,
  relayFade: [],
  relayHeatSlow: 0,
  relayCoolHours: 8,
  coverShort: [1],
  lieLowHours: 6,
  lieLowPayFactor: 0.7,
  finePerSecurityLevel: 20,
  caughtRatingLoss: 1,
  maxReroutes: 2,
  reviewHours: 3,
  reviewFineFactor: 0.5,
  ringToleranceDegrees: 20,
  ringMissSeconds: 2,
  monitorBlindSeconds: 30,
  traceJamSeconds: 10,
  echoBonusFactor: 1.5,
  echoPenaltyFactor: 0.5,
  harderSecurityAfter: 3,
  phishingAfter: 2,
  phishReplyMinutes: 30,
  phishMaxDetails: 2,
  phishWaryHours: 4,
  phishStrikes: 2,
  modelsAfter: 2,
  modelRentHours: 24,
  modelWatchSeconds: 5,
  hardwareAfter: 2,
  hardwareLossLevel: 3,
  boardJobs: 3,
  jobHours: 24,
  jobPay: [100, 200, 300, 400, 500],
  tierRatings: [0, 2, 4, 6, 8],
  jobRatings: [0, 1, 1, 2, 2],
  jobsAfter: 99,
  linksAfterRating: 4,
  shopsAfterRating: 6,
  gearAfterRating: 9,
  skillPointRating: 3,
  unlearnPrice: 1000,
  buildSeconds: 10,
  workbenchAfter: 50,
  moduleGradeRatings: [0, 5, 10],
  raidMinRating: 4,
  raidProfilePay: 300,
  raidChance: 0,
  raidCooldownHours: 24,
  raidBreachSeconds: [20, 30, 40, 50, 60],
  raidTraceSeconds: [24, 36, 48, 60, 72],
  raidBarriers: [2, 2, 3, 3, 4],
  raidPortSetbackSeconds: 8,
  raidPortFade: 0.5,
  raidMaxLocks: 2,
  raidLossCredits: 0.2,
};

const part = (slot: HardwareDef['slot'], tier: number, price: number, values: Partial<HardwareDef>): HardwareDef => ({
  id: `${slot}-${tier}`,
  slot,
  tier,
  name: `${slot} ${tier}`,
  blurb: 'A test part.',
  price,
  ...values,
});

/** Stock parts match the old fixed limits: 3 programs, 20 GB, one connection. */
export const testHardware: HardwareDef[] = [
  part('cpu', 1, 0, { speed: 1, programs: 3 }),
  part('cpu', 2, 100, { speed: 2, programs: 4 }),
  part('storage', 1, 0, { storageGb: 20 }),
  part('storage', 2, 50, { storageGb: 60 }),
  part('modem', 1, 0, { fileSpeed: 1 }),
  part('modem', 2, 80, { fileSpeed: 2 }),
  part('ports', 1, 0, { connections: 1 }),
  part('ports', 2, 70, { connections: 2 }),
  part('ports', 3, 150, { connections: 3 }),
  part('rack', 1, 200, { model: 'small', sizeGb: 8 }),
  part('sensor', 1, 90, { warn: 1 }),
  part('cooling', 1, 60, { coolSpeed: 1.5 }),
];

/** Two extra programs that are only for sale, never owned at the start. */
export const shopPrograms: ProgramDef[] = [
  { ...program('breaker-2', 'breakPassword', 10), version: 2, price: 60 },
  { ...program('gold-plated', 'copyFile', 1), price: 5000 },
  { ...program('decompiler', 'decompile', 10, 1), price: 50 },
  { ...program('planner-1', 'planRoute', 0), price: 20 },
  { ...program('planner-2', 'planRoute', 0), version: 2, price: 40 },
  { ...program('planner-3', 'planRoute', 0), version: 3, price: 60 },
  { ...program('scanner', 'scan', 6), price: 120 },
  { ...program('jammer', 'jamTrace', 1), price: 200 },
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
  harderSecurity: letter('harderSecurity'),
  phishing: letter('phishing'),
  models: letter('models'),
  modelExpired: { from: 'Farm', subject: 'Ended: {model}', body: '{model}' },
  phishRefused: { from: '{name}', subject: 'Refused: {label}', body: '{hours}' },
  phishReported: { from: 'Fixer', subject: 'Reported by {name}', body: '{title}' },
  hardware: letter('hardware'),
  jobs: letter('jobs'),
  links: letter('links'),
  shops: letter('shops'),
  gear: letter('gear'),
  news: letter('news'),
  memory: letter('memory'),
  skills: letter('skills'),
  workbench: letter('workbench'),
  decompiling: letter('decompiling'),
  routes: letter('routes'),
  stages: letter('stages'),
  stageNote: { from: '{client}', subject: 'Step {step} of {of}: {title}', body: '{brief}' },
  contractLate: { from: '{client}', subject: 'Too slow: {title}', body: 'late' },
  hardwareLost: { from: 'Fixer', subject: 'Lost {part}', body: 'now {now}' },
  defence: letter('defence'),
  raid: { from: 'Gateway', subject: 'Intrusion', body: '{who} {style}' },
  raidWon: { from: 'Gateway', subject: 'Traced {who}', body: '{home} {address}' },
  raidLost: { from: 'Gateway', subject: 'In: {who}', body: '{loss} {taunt}' },
  raidFled: { from: 'Gateway', subject: 'Plug pulled', body: '{who}' },
};

/** The directory's readme names a clerk and holds one detail; corp's secret names the boss and holds two more. */
export const testPeople: PeopleDef = {
  people: [
    { id: 'fixer', name: 'Fixer', title: 'Your fixer', address: 'fixer@test' },
    { id: 'clerk', name: 'Clerk', title: 'Help desk, Test Corp', address: 'clerk@corp.test', source: { serverId: 'directory', file: 'readme.txt' } },
    { id: 'boss', name: 'Boss', title: 'Director, Test Corp', address: 'boss@corp.test', source: { serverId: 'corp', file: 'secret.dat' } },
  ],
  facts: [
    { id: 'door', text: 'The door code is 4417.', mention: 'The code is still 4417.', source: { serverId: 'directory', file: 'readme.txt' } },
    { id: 'audit', text: 'The audit is on Friday.', mention: 'It is for the audit on Friday.', source: { serverId: 'corp', file: 'secret.dat' } },
    { id: 'dog', text: 'The boss has a dog called Rex.', mention: 'Rex says hello.', source: { serverId: 'corp', file: 'secret.dat' } },
  ],
  asks: [
    { id: 'reset', markId: 'clerk', label: 'Password reset', text: 'Reset my password.', senderId: 'boss', needs: ['audit', 'dog'], reward: { kind: 'password', serverId: 'vault', user: 'admin' }, reply: 'Done. It is hunter2.' },
    { id: 'where', markId: 'clerk', label: 'Board address', text: 'Where is the board?', senderId: 'boss', needs: ['door'], reward: { kind: 'address', serverId: 'hidden' }, reply: 'It is at 10.0.0.6.' },
  ],
};

const skill = (id: string, branch: SkillDef['branch'], row: number, effect: SkillDef['effect'], amount: number, extra: Partial<SkillDef> = {}): SkillDef => ({
  id,
  branch,
  row,
  name: id,
  blurb: 'b',
  ranks: 1,
  cost: 1,
  effect,
  amount,
  ...extra,
});

/** One skill for each effect, with round numbers. */
export const testSkills: readonly SkillDef[] = [
  skill('sharp', 'intrusion', 1, 'crackSpeed', 0.25, { ranks: 3 }),
  skill('steady', 'intrusion', 1, 'steadyHand', 0.5),
  skill('thread', 'intrusion', 2, 'extraPrograms', 1, { cost: 2 }),
  skill('overreach', 'intrusion', 3, 'overreach', 0.5, { cost: 3, needs: 'sharp' }),
  skill('align', 'intrusion', 3, 'autoAlign', 1, { cost: 2, needs: 'steady' }),
  skill('long', 'ghost', 1, 'traceSlow', 0.25, { ranks: 3 }),
  skill('patience', 'ghost', 1, 'monitorGrace', 0.5),
  skill('sweep', 'ghost', 2, 'logSpeed', 1, { cost: 2 }),
  skill('cold', 'ghost', 3, 'coldTrail', 0.5, { cost: 2, needs: 'sweep' }),
  skill('slip', 'ghost', 3, 'slipAway', 1, { cost: 3, needs: 'long' }),
  skill('tuned', 'engineering', 1, 'hardwareSpeed', 0.5, { ranks: 2 }),
  skill('slot', 'engineering', 2, 'secondSlot', 1),
  skill('tight', 'engineering', 2, 'tightBuilds', 0.25, { ranks: 2 }),
  skill('refine', 'engineering', 3, 'refine', 1, { needs: 'slot' }),
  skill('teardown', 'engineering', 1, 'teardown', 1),
];

const grades = (speed: number[], size: number[]) => speed.map((value, i) => ({ speed: value, size: size[i]!, price: 100 * (i + 1) }));

/** Round numbers: Swift doubles speed and size, Compact halves size, Quiet and Tidy halve speed. */
export const testModules: readonly ModuleDef[] = [
  { id: 'swift', name: 'Swift', blurb: 'b', fits: ['breakPassword', 'bypassProxy', 'bypassFirewall', 'copyFile', 'deleteFile', 'deleteLog', 'decrypt'], grades: grades([2, 3, 4], [2, 2, 2]) },
  { id: 'compact', name: 'Compact', blurb: 'b', fits: ['breakPassword', 'bypassProxy', 'copyFile'], grades: grades([1, 1, 1], [0.5, 0.25, 0.25]) },
  { id: 'quiet', name: 'Quiet', blurb: 'b', trait: 'quiet', fits: ['breakPassword', 'bypassProxy', 'bypassFirewall', 'copyFile'], grades: grades([0.5, 0.5, 1], [1, 1, 1]) },
  { id: 'tidy', name: 'Tidy', blurb: 'b', trait: 'tidy', fits: ['copyFile', 'deleteFile'], grades: grades([0.5, 0.5, 1], [1, 1, 1]) },
  { id: 'offload', name: 'Offload', blurb: 'b', trait: 'parallel', fits: ['copyFile', 'deleteFile', 'breakPassword'], grades: grades([0.8, 0.9, 1], [1.4, 1.3, 1.2]) },
];

export const content: Content = {
  servers: testServers,
  startingServers: ['directory'],
  programs: [...testPrograms, ...shopPrograms],
  startingPrograms: testPrograms.map((item) => item.id),
  contracts: testContracts,
  mail: testMail,
  people: testPeople,
  models: [
    { id: 'small', name: 'Small', blurb: 'b', price: 40, skills: ['read', 'scrub'] },
    { id: 'big', name: 'Big', blurb: 'b', price: 90, skills: ['read', 'scrub', 'review', 'watch'] },
  ],
  hardware: testHardware,
  companies: NO_COMPANIES,
  skills: testSkills,
  modules: testModules,
  rivals: [],
  story: { beats: [] },
  rules: testRules,
};
