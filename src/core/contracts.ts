/**
 * Contracts: jobs posted on a board server. The player takes one at a
 * time, does what it asks on the target, and delivers it for pay and
 * rating. Also the market, where programs are bought.
 */
import type { ContractDef } from '../content/schema';
import { baseFine, closeCase } from './forensics';
import type { Connection, GameState } from './state';
import { usedStorageGq } from './tasks';
import { noteIntrusion } from './trace';
import { findConnection, findProgram, findServer, once, sendMail, type Content } from './world';

export function findContract(content: Content, id: string | null): ContractDef | undefined {
  return id === null ? undefined : content.contracts.find((contract) => contract.id === id);
}

export function activeContract(state: GameState, content: Content): ContractDef | undefined {
  return findContract(content, state.contracts.activeId);
}

/** True once the thing the contract asks for has been done. */
export function objectiveMet(state: GameState, content: Content, contract: ContractDef): boolean {
  const target = state.servers[contract.targetId];
  const goal = contract.objective;
  switch (goal.kind) {
    case 'steal':
      return state.player.files.some((file) => file.name === goal.file && file.from === contract.targetId);
    case 'destroy':
      return target !== undefined && !target.files.some((file) => file.name === goal.file);
    case 'record': {
      const column = findServer(content, contract.targetId)?.records?.columns.indexOf(goal.column) ?? -1;
      return target?.records.find((row) => row[0] === goal.key)?.[column] === goal.value;
    }
  }
}

/** False if the job can no longer be done at all (e.g. the file to copy was deleted). */
export function objectivePossible(state: GameState, content: Content, contract: ContractDef): boolean {
  const goal = contract.objective;
  if (goal.kind !== 'steal' || objectiveMet(state, content, contract)) return true;
  return state.servers[contract.targetId]?.files.some((file) => file.name === goal.file) ?? false;
}

export function isLyingLow(state: GameState): boolean {
  return state.clock.gameTimeMs < state.player.lieLowUntilMs;
}

/**
 * The contracts the board would show right now. If the player's rating
 * is too low for everything that is left, the easiest remaining job is
 * offered anyway, so there is always a way forward.
 */
export function availableContracts(state: GameState, content: Content): ContractDef[] {
  const open = content.contracts.filter(
    (contract) =>
      contract.id !== state.contracts.activeId &&
      !state.contracts.completed.includes(contract.id) &&
      objectivePossible(state, content, contract),
  );
  const offered = open.filter((contract) => contract.minRating <= state.player.rating);
  if (offered.length > 0 || state.contracts.activeId !== null) return offered;
  const easiest = [...open].sort((a, b) => a.minRating - b.minRating)[0];
  return easiest ? [easiest] : [];
}

/** The connection, if it is logged in to a contracts board. Otherwise a reason. */
function atBoard(state: GameState, content: Content, connectionId: string): Connection | string {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null) return 'Log in to the board first.';
  if (findServer(content, connection.serverId)?.kind !== 'board') return 'This server is not a contracts board.';
  return connection;
}

/** Each returns null on success, or the reason it was refused. */

export function acceptContract(state: GameState, content: Content, connectionId: string, contractId: string): string | null {
  const board = atBoard(state, content, connectionId);
  if (typeof board === 'string') return board;
  if (state.contracts.activeId !== null) return 'You already have a contract. Deliver it or give it up first.';
  if (isLyingLow(state)) return 'The board has no work for you while you are lying low.';
  const contract = availableContracts(state, content).find((item) => item.id === contractId);
  if (!contract) return 'That contract is not on offer.';
  state.contracts.activeId = contract.id;
  once(state, 'firstAccept', () => sendMail(state, content, 'firstAccept'));
  return null;
}

export function abandonContract(state: GameState): string | null {
  if (state.contracts.activeId === null) return 'You have no contract.';
  state.contracts.activeId = null;
  return null;
}

export function deliverContract(state: GameState, content: Content): string | null {
  const contract = activeContract(state, content);
  if (!contract) return 'You have no contract.';
  if (!objectiveMet(state, content, contract)) return 'The job is not done yet.';
  const goal = contract.objective;
  // The stolen file goes to the client.
  if (goal.kind === 'steal') state.player.files = state.player.files.filter((file) => file.name !== goal.file);
  state.player.balance += contract.pay;
  state.player.rating += contract.rating;
  state.contracts.completed.push(contract.id);
  state.contracts.activeId = null;
  sendMail(state, content, 'paid', { client: contract.client, title: contract.title, pay: String(contract.pay) });
  once(state, 'firstDelivery', () => sendMail(state, content, 'firstDelivery'));
  return null;
}

/** Makes the record change the active contract asks for, on the connection given. */
export function alterRecord(state: GameState, content: Content, connectionId: string): string | null {
  const connection = findConnection(state, connectionId);
  const contract = activeContract(state, content);
  const goal = contract?.objective;
  if (!connection || !contract || goal?.kind !== 'record' || connection.serverId !== contract.targetId) {
    return 'You have no reason to change these records.';
  }
  const server = findServer(content, connection.serverId);
  const serverState = state.servers[connection.serverId];
  if (!server || !serverState) return 'That connection is closed.';
  if (connection.role !== 'admin') return 'Only an administrator can change records.';
  if (server.security.proxy > 0 && !connection.bypassed.proxy) return 'The proxy is blocking changes.';
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
  noteIntrusion(content, connection);
  return null;
}

export function buyProgram(state: GameState, content: Content, connectionId: string, programId: string): string | null {
  const board = atBoard(state, content, connectionId);
  if (typeof board === 'string') return board;
  const program = findProgram(content, programId);
  // Starting programs cost nothing: the market gives them back if you removed one.
  if (!program || (program.price <= 0 && !content.startingPrograms.includes(programId))) return 'That is not for sale.';
  if (state.player.programs.includes(program.id)) return 'You already own that.';
  if (state.player.balance < program.price) return 'You cannot afford that.';
  if (usedStorageGq(state, content) + program.sizeGq > content.rules.storageGq) return 'Not enough room on your gateway.';
  state.player.balance -= program.price;
  state.player.programs.push(program.id);
  return null;
}

/** Removes an installed program to free its room. */
export function uninstallProgram(state: GameState, programId: string): string | null {
  if (!state.player.programs.includes(programId)) return 'That program is not installed.';
  if (state.tasks.some((task) => task.programId === programId)) return 'That program is running. Stop it first.';
  state.player.programs = state.player.programs.filter((id) => id !== programId);
  return null;
}

/** Deletes a file from the gateway. A contract that wanted it has to be done again. */
export function deleteStoredFile(state: GameState, name: string): string | null {
  if (!state.player.files.some((file) => file.name === name)) return 'You have no such file.';
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
  const fine = Math.min(state.player.balance, baseFine(content, serverId));
  const hours = content.rules.lieLowHours;
  state.player.balance -= fine;
  state.player.rating = Math.max(0, state.player.rating - content.rules.caughtRatingLoss);
  state.player.lieLowUntilMs = state.clock.gameTimeMs + hours * 3_600_000;
  delete state.player.passwords[serverId];
  closeCase(state, serverId);

  // A job that was already finished stands; one still in progress is withdrawn.
  const contract = activeContract(state, content);
  if (contract?.targetId === serverId && !objectiveMet(state, content, contract)) {
    state.contracts.activeId = null;
    sendMail(state, content, 'contractFailed', {
      client: contract.client,
      title: contract.title,
      target: server?.name ?? 'the target',
    });
  }
  return { fine, hours };
}
