/**
 * What the route map's globe marks beside a server, read from the game:
 * the trouble the player has left there (a case open, their lines still
 * in its log, an admin on the watch), and the work and news about it.
 * Nothing here changes the game; it only gathers what is already true.
 */
import { activeContract, availableContracts } from './contracts';
import { stageView } from './stages';
import { evidenceCount } from './forensics';
import { editionDay, hasFirm, latestEdition } from './news';
import type { ContractDef } from './content';
import type { GameState, NewsItem } from './state';
import type { Content } from './world';

export interface Trouble {
  /** Game time someone reads this server's log, if a case is open. */
  readonly caseDueMs?: number;
  /** How far through the wait the case is, 0 (just opened) to 1 (being read now). */
  readonly caseShare?: number;
  /** Lines in its log that would give the player away. */
  readonly evidence: number;
  /** Why its admins are on the watch, if they are: on guard for a while, or a security firm for good. */
  readonly watch?: 'guard' | 'firm';
}

/** The worst of a server's trouble, which decides the ring the globe draws round it. */
export type TroubleKind = 'case' | 'logs' | 'watch';

/** What is wrong at one server, or null if nothing is. */
export function troubleAt(state: GameState, content: Content, serverId: string): Trouble | null {
  const now = state.clock.gameTimeMs;
  const review = state.reviews.find((item) => item.serverId === serverId);
  const evidence = evidenceCount(state, serverId);
  const alert = state.servers[serverId]?.alert;
  const watch = hasFirm(state, serverId) ? 'firm' : alert && alert.untilMs > now ? 'guard' : undefined;
  if (!review && evidence === 0 && !watch) return null;
  let caseShare: number | undefined;
  if (review) {
    const waitMs = Math.max(1, content.rules.reviewHours * 3_600_000);
    caseShare = Math.min(1, Math.max(0, 1 - (review.dueMs - now) / waitMs));
  }
  return {
    ...(review ? { caseDueMs: review.dueMs, caseShare } : {}),
    evidence,
    ...(watch ? { watch } : {}),
  };
}

/** The mark that matters most: a case being read beats lines left behind, which beat a watchful admin. */
export function troubleKind(trouble: Trouble): TroubleKind {
  if (trouble.caseDueMs !== undefined) return 'case';
  if (trouble.evidence > 0) return 'logs';
  return 'watch';
}

/** Trouble at every server the player knows of, by server id. The player's own gateway and public places are left out. */
export function troubleMap(state: GameState, content: Content): Map<string, Trouble> {
  const found = new Map<string, Trouble>();
  for (const id of state.knownServers) {
    const server = content.servers.find((item) => item.id === id);
    // Public places (boards, shops, directories) are logged into openly: nothing there is trouble.
    if (!server || server.kind === 'gateway' || server.kind === 'board' || server.kind === 'directory') continue;
    const trouble = troubleAt(state, content, id);
    if (trouble) found.set(id, trouble);
  }
  return found;
}

/** Work and news about one place on the globe. */
export interface Happening {
  readonly serverId: string;
  /** Jobs on the board whose first step is here, in board order. */
  readonly jobs: readonly ContractDef[];
  /** This morning's stories about the company here. */
  readonly news: readonly NewsItem[];
  /** True if the step of the job the player is working on is here. */
  readonly mine: boolean;
}

/**
 * Where the work is: every job on the board and every story in today's
 * paper that names a server, grouped by server. A paper from an earlier
 * day is old news and is left out.
 */
export function happenings(state: GameState, content: Content): Map<string, Happening> {
  const found = new Map<string, { jobs: ContractDef[]; news: NewsItem[]; mine: boolean }>();
  const at = (serverId: string) => {
    let entry = found.get(serverId);
    if (!entry) {
      entry = { jobs: [], news: [], mine: false };
      found.set(serverId, entry);
    }
    return entry;
  };
  const known = (id: string) => content.servers.some((server) => server.id === id && server.kind !== 'gateway');
  for (const contract of availableContracts(state, content)) {
    if (known(contract.targetId)) at(contract.targetId).jobs.push(contract);
  }
  // The job in hand is marked where its current step is.
  const active = activeContract(state, content);
  const activeTarget = active ? stageView(state, active).targetId : undefined;
  if (activeTarget && known(activeTarget)) at(activeTarget).mine = true;
  const edition = latestEdition(state);
  if (edition && edition.day === editionDay(state.clock.gameTimeMs)) {
    for (const item of edition.items) {
      if (item.serverId && known(item.serverId)) at(item.serverId).news.push(item);
    }
  }
  return new Map([...found].map(([serverId, entry]) => [serverId, { serverId, ...entry }]));
}
