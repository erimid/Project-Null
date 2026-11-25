/**
 * Contracts: jobs posted on a board server. The player takes one at a
 * time, does what it asks on the target, and delivers it for pay and
 * rating. Also the market, where programs are bought.
 */
import { modeOf } from './difficulty';
import { repayLoan } from './loan';
import { burnHeist, conditionMet, heistRefusal, postHeist } from './heists';
import type { ContractDef } from '../content/schema';
import { baseFine, closeCase } from './forensics';
import type { Connection, GameState } from './state';
import { payPart } from './crafting';
import { noteRating } from './skills';
import { freeStorageGb } from './tasks';
import { dropFromMemory, ownsProgram, stowNew, trimLoadout } from './loadout';
import { SAFE_HOUSE, hasAsset } from './assets';
import { JOB_COOL, coolHeat, coolWithTime, wanted } from './wanted';
import { isJob, postLegend, refreshJobs } from './jobs';
import { noteIntrusion } from './trace';
import { maybeScheduleRaid } from './raid';
import { advanceStory, gateRating } from './story';
import { advanceChorus } from './chorus';
import { reachEnding } from './endings';
import { printEditions, reportContract } from './news';
import { advanceLadder } from './ladder';
import { advanceEvents } from './events';
import { advanceSeries, noteSeries, seriesOf, seriesDone, seriesOpen } from './series';
import { noteRegular } from './regulars';
import { FAVOUR_CUT, hasFavour, noteDelivery, noteFailure } from './patrons';
import { sellsOnly, sellsProgram, shopFor, shopPrice } from './market';
import { advanceContract, clearClientFiles, currentStage, goalMet, goalPossible, stageIndex, stagesOf, stageView, startContract } from './stages';
import { LEAK_WRONG_PAY, endSide, leakOf, namedSuspect, termsKept, tidyNotes } from './side';
import { findConnection, findProgram, findServer, noteProgress, once, securityOf, sendMail, type Content } from './world';
import { queueLesson, reportJob, teachNow } from './record';
import { checkFeats } from './feats';

/** A hand-written contract, or a job on this game's board. */
export function findContract(state: GameState, content: Content, id: string | null): ContractDef | undefined {
  if (id === null) return undefined;
  return content.contracts.find((contract) => contract.id === id) ?? state.contracts.jobs.find((job) => job.id === id);
}

export function activeContract(state: GameState, content: Content): ContractDef | undefined {
  return findContract(state, content, state.contracts.activeId);
}

/**
 * Keeps the board's repeatable jobs topped up, and moves the story on.
 * Called on load, on every delivery, and once a game minute from the clock,
 * so a story beat arrives as soon as its rating, its spacing and the job it
 * waits on allow.
 */
export function postJobs(state: GameState, content: Content): void {
  refreshJobs(state, content, (job) => objectivePossible(state, content, job));
  advanceStory(state, content);
  advanceChorus(state, content);
  advanceLadder(state, content);
  advanceEvents(state, content);
  advanceSeries(state, content);
  printEditions(state, content);
  postHeist(state, content);
  postLegend(state, content);
  coolWithTime(state, content);
}

/**
 * True once the whole contract is done: for the contract being worked on,
 * its last step; for any other, its first.
 */
export function objectiveMet(state: GameState, content: Content, contract: ContractDef): boolean {
  const steps = stagesOf(contract);
  const index = stageIndex(state, contract);
  if (state.contracts.activeId === contract.id && index < steps.length - 1) return false;
  const stage = steps[index]!;
  return goalMet(state, content, stage.targetId, stage.objective);
}

/** False if the job can no longer be done at all (e.g. the file to copy was deleted). */
export function objectivePossible(state: GameState, content: Content, contract: ContractDef): boolean {
  const stage = currentStage(state, contract);
  // A plant's file is handed over when the contract is taken, so before then it is always possible.
  if (stage.objective.kind === 'plant' && state.contracts.activeId !== contract.id) return true;
  // So is a file the job itself puts on the server as it is taken.
  const goal = stage.objective;
  if ((goal.kind === 'read' || goal.kind === 'steal') && state.contracts.activeId !== contract.id && (stage.twists ?? []).some((twist) => twist.kind === 'drop' && twist.file === goal.file)) return true;
  // So are the notes a leak job leaves to be read.
  if (goal.kind === 'leak' && state.contracts.activeId !== contract.id) return true;
  return goalPossible(state, content, stage.targetId, stage.objective);
}

/**
 * The rating at which the next written contract comes onto the board,
 * if every one that is left is still out of reach. Undefined when there
 * is one to take now, or none left.
 */
export function nextContractRating(state: GameState, content: Content): number | undefined {
  // Story missions appear on the story's own clock, not the board's rating gate, so they are left out here.
  const left = content.contracts.filter(
    (contract) => !contract.story && !state.contracts.completed.includes(contract.id) && objectivePossible(state, content, contract) && !laterPart(state, content, contract),
  );
  if (left.length === 0 || left.some((contract) => gateRating(state, contract) <= state.player.rating)) return undefined;
  return Math.min(...left.map((contract) => gateRating(state, contract)));
}

/** True for a part of a side story that waits on a part before it. */
function laterPart(state: GameState, content: Content, contract: ContractDef): boolean {
  const found = seriesOf(content, contract.id);
  return found !== undefined && found.index > seriesDone(state, found.series.id);
}

export function isLyingLow(state: GameState): boolean {
  return state.clock.gameTimeMs < state.player.lieLowUntilMs;
}

/**
 * The contracts the board would show right now. A written contract
 * waits until the player's rating is high enough for it; the standing
 * jobs are how the rating gets there. Only if the board has nothing else
 * at all is the easiest remaining contract offered anyway, so there is
 * always a way forward.
 */
export function availableContracts(state: GameState, content: Content): ContractDef[] {
  const taken = (contract: ContractDef) =>
    contract.id === state.contracts.activeId ||
    state.contracts.completed.includes(contract.id) ||
    state.contracts.burned.includes(contract.id) ||
    !conditionMet(state, contract.when) ||
    !seriesOpen(state, content, contract) ||
    !objectivePossible(state, content, contract);
  // Ordinary written contracts, gated by rating. Story missions are left out: the director offers them on its own clock.
  const open = content.contracts.filter((contract) => !contract.story && !taken(contract));
  const jobs = state.contracts.jobs.filter(
    (job) => job.id !== state.contracts.activeId && job.expiresMs > state.clock.gameTimeMs && objectivePossible(state, content, job),
  );
  // Story missions the director has put on the board, shown whatever the rating ladder is doing.
  const story = content.contracts.filter((contract) => contract.story && state.story.offered.includes(contract.id) && !taken(contract));
  // Lying low is a state, not a wait: only the standing jobs are offered, and they pay less (see deliverContract).
  if (isLyingLow(state)) return jobs;
  const offered = open.filter((contract) => gateRating(state, contract) <= state.player.rating);
  if (offered.length > 0 || jobs.length > 0 || story.length > 0 || state.contracts.activeId !== null) return [...offered, ...jobs, ...story];
  const easiest = [...open].sort((a, b) => gateRating(state, a) - gateRating(state, b))[0];
  return [...(easiest ? [easiest] : []), ...jobs, ...story];
}

/** The connection, if it is logged in to a board server of any sort: one that posts contracts, or a shop. Otherwise a reason. */
function atShop(state: GameState, content: Content, connectionId: string): Connection | string {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null) return 'Log in to the board first.';
  if (findServer(content, connection.serverId)?.kind !== 'board') return 'This server sells nothing.';
  return connection;
}

/** The connection, if it is logged in to a contracts board. Otherwise a reason. */
function atBoard(state: GameState, content: Content, connectionId: string): Connection | string {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null) return 'Log in to the board first.';
  const server = findServer(content, connection.serverId);
  if (server?.kind !== 'board' || sellsOnly(server)) return 'This server is not a contracts board.';
  return connection;
}

/** Each returns null on success, or the reason it was refused. */

export function acceptContract(state: GameState, content: Content, connectionId: string, contractId: string): string | null {
  const board = atBoard(state, content, connectionId);
  if (typeof board === 'string') return board;
  if (state.contracts.activeId !== null) return 'You already have a contract. Deliver it or give it up first.';
  const contract = availableContracts(state, content).find((item) => item.id === contractId);
  if (!contract) return 'That contract is not on offer.';
  const short = heistRefusal(state, content, contract);
  if (short) return short;
  state.contracts.activeId = contract.id;
  // A twist that holds memory down takes hold now: whatever no longer fits goes back to the drive.
  if (isJob(contract) && contract.legend) trimLoadout(state, content);
  startContract(state, content, contract);
  once(state, 'firstAccept', () => teachNow(state, content, 'firstAccept'));
  if (stagesOf(contract).length > 1) once(state, 'stages', () => teachNow(state, content, 'stages'));
  advanceContract(state, content, contract);
  return null;
}

export function abandonContract(state: GameState, content: Content): string | null {
  if (state.contracts.activeId === null) return 'You have no contract.';
  const given = activeContract(state, content);
  // Walking away from a heist burns it like being caught.
  if (burnHeist(state, content, given)) {
    resetKinds(state);
    clearClientFiles(state);
    return null;
  }
  if (given) noteFailure(state, content, given, false);
  // A job given up is gone from the board; someone else will take it.
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== state.contracts.activeId);
  state.contracts.activeId = null;
  resetKinds(state);
  clearClientFiles(state);
  return null;
}

/** Takes the job being worked on off the player's hands and off the board, with nothing owed either way. */
export function withdrawActive(state: GameState): void {
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== state.contracts.activeId);
  state.contracts.activeId = null;
  resetKinds(state);
  clearClientFiles(state);
}

/** Clears what the newer kinds of job keep while one is under way. */
function resetKinds(state: GameState): void {
  state.contracts.heldMs = 0;
  state.contracts.guard = null;
  state.contracts.raceUntilMs = 0;
  state.contracts.heist = null;
  endSide(state);
}

/**
 * Hands the finished contract in. `choiceId` picks one of the other ways
 * to finish it the brief offers; missing = the usual way.
 */
export function deliverContract(state: GameState, content: Content, choiceId?: string): string | null {
  const contract = activeContract(state, content);
  if (!contract) return 'You have no contract.';
  if (!objectiveMet(state, content, contract)) return 'The job is not done yet.';
  const choice = choiceId === undefined ? undefined : contract.choices?.find((item) => item.id === choiceId);
  if (choiceId !== undefined && !choice && !leakOf(contract)) return 'That is not one of the ways to finish this job.';
  if (choice && !conditionMet(state, choice.when)) return 'You have not earned that way to finish this job.';
  // A leak job is handed in with a name. The right one pays in full.
  const leak = leakOf(contract);
  const named = leak && namedSuspect(leak, choiceId);
  if (leak && !named) return 'Name one of the three first.';
  const wrong = leak !== undefined && named !== leak.culprit;
  // Optional terms kept bring their bonus (see side.ts).
  const bonus = contract.terms && termsKept(state, contract) ? contract.terms.bonus : 0;
  tidyNotes(state, contract);
  // Every stolen file goes to whoever is paid for it, unless the player keeps them.
  if (!choice?.keep) {
    const handed = stagesOf(contract).flatMap((stage) => (stage.objective.kind === 'steal' ? [{ name: stage.objective.file, from: stage.targetId }] : []));
    state.player.files = state.player.files.filter((file) => !handed.some((item) => item.name === file.name && item.from === file.from));
  }
  clearClientFiles(state);
  const lowPay = isLyingLow(state) && isJob(contract) ? content.rules.lieLowPayFactor : 1;
  const pay = Math.round((choice?.pay ?? contract.pay) * lowPay * (wrong ? LEAK_WRONG_PAY : 1)) + bonus;
  state.player.balance += pay;
  state.player.rating = Math.max(0, state.player.rating + (choice?.rating ?? contract.rating));
  noteRating(state);
  const repaid = repayLoan(state, content, pay);
  state.contracts.completed.push(contract.id);
  state.contracts.activeId = null;
  // What the client adds to the payment note: who the leak was, the bonus for the terms.
  const notes: string[] = [];
  if (leak) notes.push(wrong ? `It was not ${named}. It was ${leak.culprit}, which I found out the expensive way. Half, as agreed.` : `${named} it was. Paid in full.`);
  if (repaid > 0) notes.push(state.loan.owed > 0 ? `Wren took ${repaid} credits of it against the loan. ${state.loan.owed} still owed.` : `Wren took ${repaid} credits of it, and the loan is square.`);
  if (contract.terms) notes.push(bonus > 0 ? `That includes the bonus of ${bonus} credits, as agreed.` : 'No bonus this time: the terms were not kept.');
  // The job report, written before the job's own state is cleared. The heist's crew is still on record here.
  const watch = state.record.watch;
  const report = reportJob(state, contract, pay, notes);
  resetKinds(state);
  // Work that gets done is the best cover: attention fades a little with every delivery.
  coolHeat(state, content, JOB_COOL);
  if (isJob(contract) && contract.legend) state.player.legends++;
  // The victim notices; the next edition carries it.
  reportContract(state, content, contract);
  // Whoever paid remembers, and so does anyone whose companies were hurt.
  noteDelivery(state, content, contract, choice);
  noteRegular(state, contract);
  noteSeries(state, content, contract);
  // The final job ends the story the way it was finished.
  const ending = choice ? choice.ending : contract.ending;
  if (ending) reachEnding(state, content, ending);
  // A delivered job comes off the board and another takes its place.
  state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
  postJobs(state, content);
  if (choice?.reply) {
    state.messages.push({ id: `m${state.nextId++}`, from: choice.reply.from, subject: choice.reply.subject, body: choice.reply.body, timeMs: state.clock.gameTimeMs, read: false, kind: 'story' });
  } else {
    sendMail(state, content, 'paid', { client: contract.client, title: contract.title, pay: String(pay) });
    const paid = state.messages[state.messages.length - 1]!;
    for (const note of notes) paid.body += `\n\n${note}`;
  }
  const part = payPart(state, content, contract.part);
  if (part) {
    const paid = state.messages[state.messages.length - 1]!;
    const note = `Also enclosed, as agreed: one ${part} module. It is on your Workbench.`;
    paid.body += `\n\n${note}`;
    report.notes.push(note);
  }
  state.record.watch = null;
  once(state, 'firstDelivery', () => queueLesson(state, content, 'firstDelivery'));
  noteProgress(state, content);
  report.feats.push(...checkFeats(state, report, watch ?? undefined));
  // A big, loud job may draw an enemy hacker's eye.
  maybeScheduleRaid(state, content, pay);
  return null;
}

/**
 * Writes a false line into the access log that points at the person the
 * active contract wants framed. Needs an administrator past the proxy,
 * like any change to the log.
 */
export function frameLog(state: GameState, content: Content, connectionId: string): string | null {
  const connection = findConnection(state, connectionId);
  const active = activeContract(state, content);
  const contract = active && stageView(state, active);
  const goal = contract?.objective;
  if (!connection || !contract || goal?.kind !== 'frame' || connection.serverId !== contract.targetId) {
    return 'You have nobody to point this log at.';
  }
  const server = findServer(content, connection.serverId);
  const serverState = state.servers[connection.serverId];
  if (!server || !serverState) return 'That connection is closed.';
  if (connection.role !== 'admin') return 'Only an administrator can change the log.';
  if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) return 'The proxy is blocking changes.';
  if (serverState.logs.some((entry) => entry.framed === goal.who)) return 'The log already points at them.';
  const user = server.accounts.find((account) => account.role === 'admin')?.user ?? 'admin';
  // Slipped in a little before the player arrived, so it reads like part of the record.
  const before = serverState.logs.filter((entry) => entry.timeMs < connection.openedAtMs);
  const timeMs = Math.max((before[before.length - 1]?.timeMs ?? connection.openedAtMs - 3_600_000) + 60_000, connection.openedAtMs - 20 * 60_000);
  serverState.logs.push({ id: state.nextId++, timeMs: Math.min(timeMs, connection.openedAtMs - 60_000), text: `login ${user} from ${goal.address}`, byPlayer: false, framed: goal.who });
  serverState.logs.sort((a, b) => a.timeMs - b.timeMs);
  noteIntrusion(state, content, connection);
  return null;
}

/** Makes the record change the active contract asks for, on the connection given. */
export function alterRecord(state: GameState, content: Content, connectionId: string): string | null {
  const connection = findConnection(state, connectionId);
  const active = activeContract(state, content);
  const contract = active && stageView(state, active);
  const goal = contract?.objective;
  if (!connection || !contract || goal?.kind !== 'record' || connection.serverId !== contract.targetId) {
    return 'You have no reason to change these records.';
  }
  const server = findServer(content, connection.serverId);
  const serverState = state.servers[connection.serverId];
  if (!server || !serverState) return 'That connection is closed.';
  if (connection.role !== 'admin') return 'Only an administrator can change records.';
  if (securityOf(state, server).proxy > 0 && !connection.bypassed.proxy) return 'The proxy is blocking changes.';
  const row = serverState.records.find((item) => item[0] === goal.key);
  const column = server.records?.columns.indexOf(goal.column) ?? -1;
  if (!row || column < 1) return 'That record is gone.';
  if (row[column] === goal.value) return 'That record already says so.';
  row[column] = goal.value;
  serverState.logs.push({
    id: state.nextId++,
    timeMs: state.clock.gameTimeMs,
    text: `record updated: ${goal.key}`,
    byPlayer: true,
  });
  noteIntrusion(state, content, connection);
  return null;
}

export function buyProgram(state: GameState, content: Content, connectionId: string, programId: string): string | null {
  // Any shop will do: one that posts no contracts still sells.
  const board = atShop(state, content, connectionId);
  if (typeof board === 'string') return board;
  const shop = findServer(content, board.serverId)!;
  const program = findProgram(content, programId);
  // Starting programs cost nothing: the market gives them back if you removed one.
  if (!program || (program.price <= 0 && !content.startingPrograms.includes(programId))) return 'That is not for sale.';
  if (!sellsProgram(state, shop, program)) return 'This shop does not stock that.';
  if (ownsProgram(state, program.id)) return state.player.programs.includes(program.id) ? 'You already own that.' : 'You already own that: it is built into something on your Workbench.';
  const price = shopPrice(shopFor(state, content, shop), program.price);
  if (state.player.balance < price) return 'You cannot afford that.';
  if (program.sizeGq > freeStorageGb(state, content)) return 'Not enough room on your gateway.';
  state.player.balance -= price;
  state.player.programs.push(program.id);
  // It goes straight into memory if it is better than what is loaded and there is room.
  stowNew(state, content, program.id);
  return null;
}

/** Removes an installed program to free its room. */
export function uninstallProgram(state: GameState, programId: string): string | null {
  if (!state.player.programs.includes(programId)) return 'That program is not installed.';
  if (state.tasks.some((task) => task.programId === programId)) return 'That program is running. Stop it first.';
  state.player.programs = state.player.programs.filter((id) => id !== programId);
  dropFromMemory(state, programId);
  return null;
}

/** Deletes a file from the gateway. A contract that wanted it has to be done again. */
export function deleteStoredFile(state: GameState, name: string): string | null {
  if (!state.player.files.some((file) => file.name === name)) return 'You have no such file.';
  if (state.tasks.some((task) => task.target.kind === 'decrypt' && task.target.file === name)) {
    return 'That file is being decrypted. Stop the program first.';
  }
  state.player.files = state.player.files.filter((file) => file.name !== name);
  return null;
}

/**
 * What being traced costs, beyond the cut connection: a fine, rating,
 * the passwords broken on that server, an unfinished contract against
 * it, and a spell without work.
 */
export function punish(state: GameState, content: Content, serverId: string): { fine: number; hours: number } {
  const server = findServer(content, serverId);
  // Patrons in the inner circle soften the blow: one pays half the fine, one shortens the time out of sight.
  // Someone already wanted pays more and stays out of sight longer (see wanted.ts).
  const heat = wanted(state);
  const fine = Math.min(state.player.balance, Math.round(baseFine(content, serverId) * heat.fines * modeOf(state).fines * (hasFavour(state, content, 'fineCut') ? FAVOUR_CUT : 1)));
  const hours = content.rules.lieLowHours * heat.lieLow * (hasFavour(state, content, 'lieLowCut') ? FAVOUR_CUT : 1) * (hasAsset(state, content, 'safeHouse') ? SAFE_HOUSE.lieLow : 1);
  state.player.balance -= fine;
  state.player.rating = Math.max(0, state.player.rating - content.rules.caughtRatingLoss);
  state.player.lieLowUntilMs = state.clock.gameTimeMs + hours * 3_600_000;
  delete state.player.passwords[serverId];
  closeCase(state, serverId);

  // Caught anywhere while a heist is under way: the whole plan burns.
  if (burnHeist(state, content, activeContract(state, content))) {
    resetKinds(state);
    clearClientFiles(state);
    return { fine, hours };
  }
  // A job that was already finished stands; one still in progress against this server is withdrawn.
  const active = activeContract(state, content);
  const contract = active && stageView(state, active);
  if (active && contract?.targetId === serverId && !objectiveMet(state, content, active)) {
    noteFailure(state, content, active, true);
    clearClientFiles(state);
    endSide(state);
    state.contracts.activeId = null;
    state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== active.id);
    sendMail(state, content, 'contractFailed', {
      client: contract.client,
      title: contract.title,
      target: server?.name ?? 'the target',
    });
  }
  return { fine, hours };
}
