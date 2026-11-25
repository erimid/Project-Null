/**
 * The side kinds of board job: more ways for an ordinary job to go, so the
 * middle of a career is not the same three errands. Each opens at a rating
 * of its own, and the board mixes them in among the usual jobs.
 *
 * - deliver: put a file the client sends onto the company's server.
 * - leak (find the leak): three notes appear on the company's server. Read
 *   them, then hand the job in by naming one of three members of staff. Two
 *   notes each rule one of them out.
 * - wipe (wipe a trail): another runner left lines in the logs of two
 *   companies. Remove them all, on one clock.
 * - round: three small companies in a row, one clock, paid for each stop
 *   and a bonus for all three.
 * - borrow (borrowed login): the company's password has just been made
 *   much stronger. Its public notices say who resets passwords and for
 *   whom, so a letter (see phish.ts) gets the login without breaking it.
 *
 * Also optional terms: a condition on an ordinary job that pays a bonus
 * if kept (see side.ts).
 *
 * Everything here draws on streams forked from where the board's own
 * stands, as jobs.ts does, so the board's other draws stay as they were.
 */
import { SIDE_KINDS, type NoteTemplate, type SideKind, type SideWording } from '../content/companies';
import type { ContractDef, ServerDef, StageDef, TermsDef, TwistDef } from '../content/schema';
import type { FactDef, PersonDef } from '../content/people';
import { fill } from './generate';
import { boardObjectives, tierForRating, touchedServers } from './jobs';
import type { Rng } from './rng';
import type { GameState, Job } from './state';
import type { Content } from './world';

/** The rating each side kind opens at, and what it pays as a share of an ordinary job against the same company. */
export const SIDE_RULES: Readonly<Record<SideKind, { rating: number; pay: number }>> = {
  deliver: { rating: 10, pay: 1.2 },
  leak: { rating: 20, pay: 1.2 },
  wipe: { rating: 25, pay: 1.6 },
  round: { rating: 30, pay: 1.0 },
  borrow: { rating: 35, pay: 1.3 },
};
/** Share of board jobs that are a side kind, for each kind the player's rating has opened. */
export const SIDE_SHARE_EACH = 0.07;
/** Game hours a wipe job gives for its two servers, and a round for its three. */
export const WIPE_HOURS = 7;
export const ROUND_HOURS = 10;
/** Levels a borrowed-login job's company has put its password up by. */
export const BORROW_RAISE = 2;

/** From this rating, some ordinary one-step jobs carry optional terms. */
export const TERMS_RATING = 10;
export const TERMS_SHARE = 0.25;
/** The bonus for keeping them, as a share of the job's pay. */
export const TERMS_BONUS = 0.25;
export const LIGHT_RELAYS = 4;

const fifty = (credits: number) => Math.round(credits / 50) * 50;
const note = (template: NoteTemplate, values: Record<string, string>) => ({ name: fill(template.name, values), text: fill(template.text, values) });
const drop = (file: { name: string; text: string }, folder: string, access?: 'guest'): TwistDef => ({ kind: 'drop', file: file.name, sizeGq: 1, text: file.text, folder, ...(access ? { access } : {}) });

/** Different made-up people, by name. */
function people(content: Content, rng: Rng, count: number): string[] {
  const names = new Set<string>();
  for (let tries = 0; names.size < count && tries < count * 8; tries++) names.add(`${rng.pick(content.companies.first)} ${rng.pick(content.companies.last)}`);
  return [...names];
}

/** Other generated companies free to be part of a job, none of them `not`. */
function others(state: GameState, content: Content, not: readonly string[], fits: (server: ServerDef) => boolean): ServerDef[] {
  const busy = touchedServers(state);
  return content.servers.filter((server) => server.generated && !not.includes(server.id) && !busy.has(server.id) && fits(server));
}

type Values = Record<string, string>;
type Make = (state: GameState, content: Content, job: Job, server: ServerDef, values: Values, rng: Rng, words: SideWording) => Job | undefined;

const worded = (job: Job, words: { titles: readonly string[]; summaries: readonly string[]; briefs: readonly string[] }, values: Values, rng: Rng): Job => ({
  ...job,
  title: rng.pick(words.titles),
  summary: fill(rng.pick(words.summaries), values),
  brief: fill(rng.pick(words.briefs), values),
});

const deliver: Make = (state, _content, job, server, values, rng, words) => {
  const file = fill(rng.pick(words.deliver.files), { n: String(rng.int(100, 999)) });
  if (state.player.files.some((own) => own.name === file) || state.servers[server.id]?.files.some((item) => item.name === file)) return undefined;
  const tier = server.generated!.tier;
  return { ...worded(job, words.deliver, { ...values, file }, rng), pay: fifty(job.pay * SIDE_RULES.deliver.pay), objective: { kind: 'plant', file, sizeGq: rng.int(2, 4) + 2 * tier } };
};

const leak: Make = (state, content, job, server, values, rng, words) => {
  const suspects = people(content, rng, 3);
  if (suspects.length < 3) return undefined;
  const culprit = rng.pick(suspects);
  const n = String(rng.int(100, 999));
  const cleared = suspects.filter((name) => name !== culprit);
  const clears = rng.shuffle([...words.leak.clears]).slice(0, 2);
  const [a, b, c] = suspects as [string, string, string];
  const all = { ...values, a, b, c, n };
  const notes = [note(rng.pick(words.leak.leads), all), ...clears.map((template, i) => note(template, { ...all, staff: cleared[i]! }))];
  const here = state.servers[server.id]?.files ?? [];
  if (new Set(notes.map((item) => item.name)).size !== notes.length || notes.some((item) => here.some((file) => file.name === item.name))) return undefined;
  return {
    ...worded(job, words.leak, all, rng),
    pay: fifty(job.pay * SIDE_RULES.leak.pay),
    objective: { kind: 'leak', files: notes.map((item) => item.name), suspects, culprit },
    twists: notes.map((item) => drop(item, 'review')),
  };
};

const wipe: Make = (state, content, job, server, values, rng, words) => {
  const racers = content.companies.jobs.racers ?? [];
  if (racers.length === 0) return undefined;
  const tier = server.generated!.tier;
  const second = others(state, content, [server.id], (other) => Math.abs(other.generated!.tier - tier) <= 1 && other.generated!.tier <= tierForRating(state.player.rating, content.rules.tierRatings));
  if (second.length === 0) return undefined;
  const next = rng.pick(second);
  const who = rng.pick(racers);
  const all = { ...values, who, company2: next.name, city2: next.city, hours: String(WIPE_HOURS) };
  return {
    ...worded(job, words.wipe, all, rng),
    pay: fifty(job.pay * SIDE_RULES.wipe.pay),
    rating: job.rating + 1,
    objective: { kind: 'wipe', who },
    stages: [{ targetId: next.id, objective: { kind: 'wipe', who }, brief: fill(rng.pick(words.wipe.next), all) }],
    window: { minutes: WIPE_HOURS * 60 },
  };
};

const round: Make = (state, content, job, server, values, rng, words) => {
  // Small places: a tier or two under what the board is offering.
  const top = Math.max(1, tierForRating(state.player.rating, content.rules.tierRatings) - 1);
  const small = rng.shuffle(others(state, content, [], (other) => other.generated!.tier <= top && other.generated!.tier >= top - 1));
  const stops: StageDef[] = [];
  const names = new Set(state.player.files.map((file) => file.name));
  for (const company of small) {
    if (stops.length === 3) break;
    // One copy or delete at each: never two files of one name, since the gateway holds one file of a name.
    const goals = boardObjectives(state, company).flatMap((goal) => (goal.kind !== 'record' && !names.has(goal.file) ? [goal] : []));
    if (goals.length === 0) continue;
    const goal = rng.pick(goals);
    names.add(goal.file);
    stops.push({ targetId: company.id, objective: goal });
  }
  if (stops.length < 3) return undefined;
  const at = stops.map((stop) => content.servers.find((item) => item.id === stop.targetId)!);
  const usual = at.reduce((sum, company) => sum + (content.rules.jobPay[company.generated!.tier - 1] ?? 0), 0) / at.length;
  const each = fifty(usual * SIDE_RULES.round.pay);
  const bonus = each;
  const all = { ...values, company: at[0]!.name, city: at[0]!.city, company2: at[1]!.name, company3: at[2]!.name, each: String(each), bonus: String(bonus), hours: String(ROUND_HOURS) };
  void server;
  return {
    ...worded(job, words.round, all, rng),
    targetId: stops[0]!.targetId,
    objective: stops[0]!.objective,
    stages: stops.slice(1).map((stop, i) => ({ ...stop, brief: fill(rng.pick(words.round.next), { ...all, company: at[i + 1]!.name }) })),
    pay: each + bonus,
    rating: job.rating + 1,
    round: { each },
    window: { minutes: ROUND_HOURS * 60 },
  };
};

const borrow: Make = (state, content, job, server, values, rng, words) => {
  const admin = server.accounts.find((account) => account.role === 'admin');
  if (!admin || server.security.password === 0 || state.player.passwords[server.id]?.includes(admin.user)) return undefined;
  const [mark, boss, other] = people(content, rng, 3);
  if (!mark || !boss || !other) return undefined;
  const n = String(rng.int(100, 999));
  const all = { ...values, mark, boss, other, n, goal: job.summary };
  const list = note(rng.pick(words.borrow.lists), all);
  const picked = rng.shuffle([...words.borrow.notes]).slice(0, 2);
  const notes = picked.map((template) => note(template, all));
  const here = state.servers[server.id]?.files ?? [];
  if ([list, ...notes].some((item) => here.some((file) => file.name === item.name))) return undefined;
  const id = (what: string) => `${job.id}:${what}`;
  const domain = server.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const person = (what: string, name: string, title: string): PersonDef => ({
    id: id(what),
    name,
    title: `${title}, ${server.name}`,
    address: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${domain}.example`,
    source: { serverId: server.id, file: list.name },
  });
  const facts: FactDef[] = picked.map((template, i) => ({ id: id(`fact${i}`), text: fill(template.fact, all), mention: fill(template.mention, all), source: { serverId: server.id, file: notes[i]!.name } }));
  const ask = rng.pick(words.borrow.asks);
  return {
    ...worded(job, words.borrow, all, rng),
    pay: fifty(job.pay * SIDE_RULES.borrow.pay),
    twists: [{ kind: 'raise', layer: 'password', by: BORROW_RAISE }, drop(list, 'notices', 'guest'), ...notes.map((item) => drop(item, 'notices', 'guest'))],
    phish: {
      people: [person('mark', mark, 'IT support'), person('boss', boss, 'Office manager'), person('other', other, 'Front desk')],
      facts,
      asks: [{ id: id('ask'), markId: id('mark'), senderId: id('boss'), needs: facts.map((fact) => fact.id), label: fill(ask.label, all), text: fill(ask.text, all), reward: { kind: 'password', serverId: server.id, user: admin.user }, reply: fill(ask.reply, all) }],
    },
  };
};

const MAKERS: Readonly<Record<SideKind, Make>> = { deliver, leak, wipe, round, borrow };

/** The side kinds the player's rating has opened. */
export const openSideKinds = (rating: number): SideKind[] => SIDE_KINDS.filter((kind) => rating >= SIDE_RULES[kind].rating);

/** Maybe turns a fresh one-step job into one of the side kinds. Undefined = leave it as it is. */
export function sideJob(state: GameState, content: Content, job: Job, server: ServerDef, values: Values, rng: Rng): Job | undefined {
  const words = content.companies.jobs.side;
  if (!words) return undefined;
  const open = openSideKinds(state.player.rating);
  if (open.length === 0 || !rng.chance(SIDE_SHARE_EACH * open.length)) return undefined;
  return MAKERS[rng.pick(open)](state, content, job, server, values, rng, words);
}

/** Maybe gives an ordinary one-step job optional terms: a bonus for doing it a particular way. */
export function maybeTerms(state: GameState, content: Content, job: Job, server: ServerDef, rng: Rng): Job {
  if (!content.companies.jobs.side || state.player.rating < TERMS_RATING) return job;
  if (job.stages || job.race || job.window || job.phish || job.terms || !['steal', 'destroy', 'record', 'plant'].includes(job.objective.kind)) return job;
  if (!rng.chance(TERMS_SHARE)) return job;
  const tier = server.generated?.tier ?? 1;
  const bonus = Math.max(100, fifty(job.pay * TERMS_BONUS));
  // "Quietly" means nothing where nobody is watching.
  const kinds: TermsDef['kind'][] = server.security.monitor > 0 ? ['quiet', 'fast', 'light'] : ['fast', 'light'];
  const kind = rng.pick(kinds);
  const terms: TermsDef = kind === 'quiet' ? { kind, bonus } : kind === 'fast' ? { kind, bonus, minutes: 120 + 40 * tier } : { kind, bonus, relays: LIGHT_RELAYS };
  return { ...job, terms };
}

/** True for a job of one of the side kinds. */
export function isSideJob(contract: ContractDef): boolean {
  return contract.window !== undefined || contract.phish !== undefined || contract.objective.kind === 'leak' || contract.objective.kind === 'wipe' || ('expiresMs' in contract && contract.objective.kind === 'plant');
}
