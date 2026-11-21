/**
 * The guided first job: while the player works through the library job,
 * Wren says what to press next. Pure reading of the game state, so the
 * screen can light up the right button and nothing else is tracked.
 */
import { objectiveMet } from './contracts';
import { findServer, type Content } from './world';
import type { GameState } from './state';

/** The job the guide walks through, and the board it is taken from. */
export const GUIDED_JOB = 'tallis-cards';
const BOARD = 'backroom';

export type GuideId =
  | 'goto'
  | 'login'
  | 'accept'
  | 'leave-board'
  | 'goto-target'
  | 'break'
  | 'wait'
  | 'enter'
  | 'relog'
  | 'copy'
  | 'scrub'
  | 'leave-target'
  | 'deliver';

export interface GuideStep {
  readonly id: GuideId;
  /** The server a button or address belongs to, for steps about one. */
  readonly serverId?: string;
  /** The file a copy step is about. */
  readonly file?: string;
  /** What Wren says. */
  readonly text: string;
}

/** What to press next on the first job, or null once the first job is delivered (or the player took another one). */
export function guideStep(state: GameState, content: Content): GuideStep | null {
  if (state.contracts.completed.length > 0) return null;
  const board = findServer(content, BOARD);
  const job = content.contracts.find((contract) => contract.id === GUIDED_JOB);
  if (!board || !job) return null;
  if (state.contracts.activeId !== null && state.contracts.activeId !== GUIDED_JOB) return null;
  const target = findServer(content, job.targetId);
  if (!target) return null;
  const goal = job.objective;
  const file = goal.kind === 'steal' ? goal.file : '';
  const at = (id: string) => state.connections.find((connection) => connection.serverId === id);

  if (state.contracts.activeId === null) {
    const here = at(BOARD);
    if (!here) return { id: 'goto', serverId: BOARD, text: `Open the Route map, pick ${board.name} in your address book and press Connect.` };
    if (here.user === null) return { id: 'login', text: `Log in to ${board.name} with your invite.` };
    return { id: 'accept', text: 'Open Contracts and press Accept on the library job.' };
  }

  const done = objectiveMet(state, content, job);
  const there = at(target.id);
  if (done) {
    if (there && there.user !== null && state.servers[target.id]?.logs.some((entry) => entry.byPlayer)) {
      return { id: 'scrub', text: 'Open Logs, press Select all, then Scrub. Every line there is yours or harmless, and a clean log is worth the few seconds.' };
    }
    if (there) return { id: 'leave-target', text: 'Now disconnect. Close the tab at the top with the ×.' };
    if (state.connections.length > 0) return { id: 'leave-board', text: 'Disconnect from every connection. Close the tabs at the top with the ×.' };
    return { id: 'deliver', text: 'Press your contract at the top right of the screen, then press Deliver. You are paid on the spot.' };
  }

  const board_ = at(BOARD);
  if (board_) return { id: 'leave-board', text: `Good. Disconnect from ${board.name} with the × on its tab. Your gateway holds one connection at a time.` };
  if (!there) {
    return {
      id: 'goto-target',
      serverId: target.id,
      text: `On the Route map, pick ${target.name} and press Connect. No relays needed on this one: nobody is watching that machine.`,
    };
  }
  if (there.user === null) {
    const known = (state.player.passwords[target.id]?.length ?? 0) > 0;
    if (state.tasks.some((task) => task.connectionId === there.id && task.target.kind === 'password')) {
      return { id: 'wait', text: 'The breaker is working. Give it a moment.' };
    }
    return known
      ? { id: 'enter', text: 'You have the password. Log in to the administrator account.' }
      : { id: 'break', text: 'Press Break password on the administrator account. It takes a few seconds.' };
  }
  if (there.role !== 'admin') return { id: 'relog', text: 'That account is only a guest. Log out, then break the administrator password.' };
  if (state.tasks.some((task) => task.connectionId === there.id && task.target.kind === 'copyFile')) {
    return { id: 'wait', text: 'Copying. Give it a moment.' };
  }
  return { id: 'copy', file, text: `Open Files and press Copy next to ${file}.` };
}
