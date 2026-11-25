/**
 * Cleanup has stakes: some hours after an intrusion, the target reads
 * its access log. Lines that show what the player did there cost a fine.
 */
import type { GameState, LogEntry } from './state';
import { effect } from './skills';
import { findServer, sendMail, type Content } from './world';
import { REVIEW_HEAT, raiseHeat, wanted } from './wanted';
import { modeOf } from './difficulty';
import { maybeLend } from './loan';

/** Log lines that say someone logged in or changed something. A connection opening or closing proves nothing. */
const EVIDENCE = /^(login |file copied|file deleted|file uploaded|record updated)/;

/** True for a line that would give the player away in a review. */
export function isEvidence(entry: LogEntry): boolean {
  return entry.byPlayer && EVIDENCE.test(entry.text);
}

/** How many lines on a server would give the player away right now. */
export function evidenceCount(state: GameState, serverId: string): number {
  return state.servers[serverId]?.logs.filter(isEvidence).length ?? 0;
}

/** What a server charges someone it has identified: more for better-defended servers. */
export function baseFine(content: Content, serverId: string): number {
  const server = findServer(content, serverId);
  const levels = server ? Object.values(server.security).reduce((sum, level) => sum + level, 0) : 0;
  return content.rules.finePerSecurityLevel * Math.max(1, levels);
}

/** Books a look through a server's logs, unless one is already coming. */
export function scheduleReview(state: GameState, content: Content, serverId: string): void {
  if (state.reviews.some((review) => review.serverId === serverId)) return;
  const hours = content.rules.reviewHours * (1 + effect(state, content, 'coldTrail'));
  state.reviews.push({ serverId, dueMs: state.clock.gameTimeMs + hours * 3_600_000 });
}

/** The server already knows who it was: nothing left there counts against the player again. */
export function closeCase(state: GameState, serverId: string): void {
  state.reviews = state.reviews.filter((review) => review.serverId !== serverId);
  for (const entry of state.servers[serverId]?.logs ?? []) entry.byPlayer = false;
}

/**
 * Carries out every review that has come due. One for a server the
 * player is connected to again waits until they have left: nobody reads
 * the log of a break-in that is still going on, and the player gets the
 * same chance to clean up as on any other visit.
 */
export function runReviews(state: GameState, content: Content): void {
  const due = state.reviews.filter(
    (review) => review.dueMs <= state.clock.gameTimeMs && !state.connections.some((connection) => connection.serverId === review.serverId),
  );
  for (const review of due) {
    const found = evidenceCount(state, review.serverId);
    if (found > 0) {
      const factor = content.rules.reviewFineFactor * (1 - effect(state, content, 'coldTrail')) * wanted(state).fines * modeOf(state).fines;
      const fine = Math.min(state.player.balance, Math.round(baseFine(content, review.serverId) * factor));
      state.player.balance -= fine;
      sendMail(state, content, 'review', {
        target: findServer(content, review.serverId)?.name ?? 'The target',
        lines: found === 1 ? '1 line' : `${found} lines`,
        fine: String(fine),
      });
      // Logs left behind are attention drawn.
      raiseHeat(state, content, REVIEW_HEAT);
      maybeLend(state, content);
    }
    closeCase(state, review.serverId);
  }
}
