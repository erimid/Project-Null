/**
 * A world that moves: the Continental Wire prints an edition every
 * morning, built from what actually happened.
 *
 * - The player's own work makes the next edition, written from the
 *   victim's side and never naming the player.
 * - Companies react. A generated company that is hit puts one layer on
 *   its guard for a few days; one hit often enough hires a security firm
 *   and stays harder for good.
 * - Background events arrive on their own. Some open a short-lived job.
 * - Story beats leave small items the public misreads.
 *
 * Everything random here draws on the 'news' stream, so the board's own
 * jobs and every other system play out as they did before.
 */
import type { NewsDef, NewsJobKind, NewsTemplate } from '../content/news';
import type { ContractDef, LayerName, ServerDef } from '../content/schema';
import { postNewsJob } from './jobs';
import { fill } from './generate';
import { stagesOf } from './stages';
import type { GameState, NewsItem } from './state';
import { beatPassed } from './story';
import { endingPaper } from './endings';
import { stream } from './streams';
import { findServer, once, sendMail, type Content } from './world';

/** The hour of the game day each morning edition comes out. */
export const EDITION_HOUR = 6;
/** Editions kept for the archive. */
export const KEEP_EDITIONS = 7;
/** Game hours a company that was hit stays on its guard. */
export const GUARD_HOURS = 72;
/** Hits on one company before it hires a security firm. */
export const FIRM_HITS = 3;
/** Background events in each edition. */
export const EVENTS_PER_EDITION = 2;
/** Most jobs the news can have open on the board at once. */
export const MAX_NEWS_JOBS = 2;

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OCEANS = ['Atlantic', 'Pacific', 'Indian Ocean'];
const LAYER_WORDS: Readonly<Record<LayerName, string>> = { password: 'passwords', proxy: 'proxy', firewall: 'firewall', monitor: 'network monitoring' };
const EMPTY: NewsDef = {
  jobs: { steal: [], destroy: [], record: [], read: [], plant: [], frame: [], guard: [], hold: [], hunt: [], swap: [], caught: [] },
  reactions: { guard: [], firm: [] },
  events: [],
  story: [],
  handles: [],
  weather: [],
};

const newsOf = (content: Content): NewsDef => content.news ?? EMPTY;

/** The number of the edition that covers a moment: days since 1970, counted from each morning's print hour. */
export function editionDay(timeMs: number): number {
  return Math.floor((timeMs - EDITION_HOUR * 3_600_000) / DAY_MS);
}

/** Game time an edition was printed. */
export function editionTimeMs(day: number): number {
  return day * DAY_MS + EDITION_HOUR * 3_600_000;
}

/** True if a company has hired a security firm and stays harder for good. */
export function hasFirm(state: GameState, serverId: string): boolean {
  return state.news.firms.includes(serverId);
}

function values(state: GameState, server: ServerDef, extra: Record<string, string> = {}): Record<string, string> {
  return {
    company: server.name,
    city: server.city,
    CITY: server.city.toUpperCase(),
    country: server.country,
    weekday: WEEKDAYS[new Date(state.clock.gameTimeMs).getUTCDay()]!,
    records: server.records?.title.toLowerCase() ?? 'records',
    ...extra,
  };
}

/** Templates that suit a company: those for its line of business, or else the ones for any. */
function suited(templates: readonly NewsTemplate[], server: ServerDef): readonly NewsTemplate[] {
  const sector = server.generated?.sector;
  const own = templates.filter((item) => sector !== undefined && item.sectors?.includes(sector));
  const general = templates.filter((item) => !item.sectors);
  // A sector's own wording is used about half the time it exists, so the general lines still turn up.
  return own.length > 0 && general.length > 0 ? [...own, ...general] : own.length > 0 ? own : general;
}

function item(state: GameState, kind: NewsItem['kind'], template: NewsTemplate, fillWith: Record<string, string>, serverId?: string): NewsItem {
  return {
    id: `n${state.nextId++}`,
    kind,
    headline: fill(template.headline, fillWith),
    body: fill(template.body, fillWith),
    ...(serverId ? { serverId } : {}),
  };
}

/** Puts one story about the player's work against a company in the next edition. */
function report(state: GameState, content: Content, server: ServerDef, kind: NewsJobKind): void {
  const templates = suited(newsOf(content).jobs[kind], server);
  if (templates.length === 0) return;
  const rng = stream(state, 'news');
  state.news.pending.push(item(state, 'you', rng.pick(templates), values(state, server), server.id));
}

/** A company that was hit reacts: a few days on its guard, or for good once it has had enough. */
function react(state: GameState, content: Content, server: ServerDef): void {
  // Only the companies made for this game react. The written ones keep the security their jobs were written for.
  if (!server.generated) return;
  const hits = (state.news.hits[server.id] = (state.news.hits[server.id] ?? 0) + 1);
  const news = newsOf(content);
  const rng = stream(state, 'news');
  if (hits >= FIRM_HITS && !hasFirm(state, server.id)) {
    state.news.firms.push(server.id);
    if (news.reactions.firm.length > 0) state.news.pending.push(item(state, 'world', rng.pick(news.reactions.firm), values(state, server), server.id));
    return;
  }
  const live = state.servers[server.id];
  if (!live || (live.alert && live.alert.untilMs > state.clock.gameTimeMs)) return;
  // The layer they tighten is one they have; a company without a proxy or firewall watches harder instead.
  const layers = (['password', 'proxy', 'firewall', 'monitor'] as const).filter((layer) => server.security[layer] > 0);
  const layer = layers.length > 0 ? rng.pick(layers) : 'monitor';
  live.alert = { raise: { [layer]: 1 }, untilMs: state.clock.gameTimeMs + GUARD_HOURS * 3_600_000 };
  if (news.reactions.guard.length > 0) {
    state.news.pending.push(item(state, 'world', rng.pick(news.reactions.guard), values(state, server, { layer: LAYER_WORDS[layer] }), server.id));
  }
}

/**
 * A delivered contract makes the news: one story for each company it
 * touched, and each of those companies reacts. Story missions stay out of
 * the paper. Call it after the contract is paid.
 */
export function reportContract(state: GameState, content: Content, contract: ContractDef): void {
  if (contract.story) return;
  const seen = new Set<string>();
  for (const stage of stagesOf(contract)) {
    if (seen.has(stage.targetId)) continue;
    seen.add(stage.targetId);
    const server = findServer(content, stage.targetId);
    if (!server || server.kind !== 'company') continue;
    const kind = stage.objective.kind;
    // A trail wiped from a log is the one job nobody ever hears about.
    if (kind === 'wipe') continue;
    // Notes read to find a leak make the paper as any file read does.
    report(state, content, server, kind === 'leak' ? 'read' : kind);
    // A company the player guarded, sat in or only passed through has nothing to put its guard up about.
    if (!['guard', 'hold', 'hunt'].includes(kind)) react(state, content, server);
  }
}

/** Being traced makes the news too, and the company is on its guard after it. */
export function reportCaught(state: GameState, content: Content, serverId: string): void {
  const server = findServer(content, serverId);
  if (!server || server.kind !== 'company') return;
  report(state, content, server, 'caught');
  react(state, content, server);
}

/** One background event, against a random generated company. Some open a job. */
function backgroundEvent(state: GameState, content: Content, used: Set<string>): NewsItem | undefined {
  const news = newsOf(content);
  const rng = stream(state, 'news');
  const companies = content.servers.filter((server) => server.generated && !used.has(server.id));
  // No two stories of the same kind in one edition.
  const events = news.events.filter((event) => !used.has(`event:${event.id}`));
  if (events.length === 0 || companies.length < 2) return undefined;
  const event = rng.pick(events);
  used.add(`event:${event.id}`);
  const server = rng.pick(companies);
  const other = rng.pick(companies.filter((company) => company.id !== server.id));
  used.add(server.id);
  const fillWith = values(state, server, {
    company2: other.name,
    city2: other.city,
    handle: news.handles.length > 0 ? rng.pick(news.handles) : 'Nobody',
    ocean: rng.pick(OCEANS),
  });
  const printed = item(state, 'world', event, fillWith, server.id);
  if (event.job && state.contracts.jobs.filter((job) => job.news).length < MAX_NEWS_JOBS) {
    // Only for companies the player could be sent to now: not above the board's reach.
    const reach = content.rules.tierRatings.filter((min) => state.player.rating >= min).length;
    if (server.generated!.tier <= reach) {
      const job = postNewsJob(state, content, server, rng, event.job.hours, event.job.pay, printed.headline);
      if (job) printed.jobId = job.id;
    }
  }
  return printed;
}

/**
 * Prints the morning edition if one is due: the stories waiting about
 * the player, any story items, a couple of background events, and the
 * weather. Only the latest missed edition is printed, so a long wait
 * never fills the archive with empty days. Cheap when nothing is due.
 */
export function printEditions(state: GameState, content: Content): void {
  const today = editionDay(state.clock.gameTimeMs);
  const last = state.news.editions[state.news.editions.length - 1];
  if (last && last.day >= today) return;
  const news = newsOf(content);
  const rng = stream(state, 'news');
  const items: NewsItem[] = [...state.news.pending];
  state.news.pending = [];

  // Story items follow their beat once it has passed.
  for (const story of news.story) {
    const flag = `news:${story.after}`;
    if (!beatPassed(state, story.after) || state.flags.includes(flag)) continue;
    state.flags.push(flag);
    items.push({ id: `n${state.nextId++}`, kind: 'story', headline: story.headline, body: story.body });
  }

  // After the ending, the world has moved on, and the paper says so.
  const after = endingPaper(state, content, rng);
  if (after) items.push(after);

  const used = new Set(items.flatMap((entry) => (entry.serverId ? [entry.serverId] : [])));
  for (let i = 0; i < EVENTS_PER_EDITION; i++) {
    const event = backgroundEvent(state, content, used);
    if (event) items.push(event);
  }

  const city = findServer(content, content.servers.find((server) => server.kind === 'gateway')?.id ?? '')?.city ?? 'the capital';
  const weather = news.weather.length > 0 ? fill(rng.pick(news.weather), { city }) : '';
  state.news.editions.push({ day: today, items, weather });
  // The first time the player's work makes the paper, Wren points it out.
  const mine = items.find((entry) => entry.kind === 'you' && entry.serverId);
  if (mine) {
    const company = findServer(content, mine.serverId!)?.name ?? 'a company';
    once(state, 'news', () => {
      sendMail(state, content, 'news', { company });
      state.record.lessons.lastJob = state.contracts.completed.length;
    });
  }
  state.news.editions = state.news.editions.slice(-KEEP_EDITIONS);
}

/** The edition on the front page: the latest one printed. */
export function latestEdition(state: GameState) {
  return state.news.editions[state.news.editions.length - 1];
}

/** True if a company has been in the paper about the player's work, or a reaction to it, since `sinceMs`. */
export function inTheNews(state: GameState, serverId: string, sinceMs: number): boolean {
  return state.news.editions.some(
    (edition) => editionTimeMs(edition.day) >= sinceMs && edition.items.some((entry) => entry.serverId === serverId && entry.kind !== 'story'),
  );
}

/** Puts a word beside a server on the globe and in the address book, for good or until `untilMs`. The story uses it. */
export function markServer(state: GameState, serverId: string, label: string, untilMs?: number): void {
  state.news.marks[serverId] = { label, ...(untilMs === undefined ? {} : { untilMs }) };
}

/** The word beside a server right now, if any: a story mark, or that it is on its guard or has a security firm. */
export function serverMark(state: GameState, serverId: string): string | undefined {
  const mark = state.news.marks[serverId];
  if (mark && (mark.untilMs === undefined || mark.untilMs > state.clock.gameTimeMs)) return mark.label;
  if (hasFirm(state, serverId)) return 'Security firm';
  const alert = state.servers[serverId]?.alert;
  if (alert && alert.untilMs > state.clock.gameTimeMs) return 'On guard';
  return undefined;
}
