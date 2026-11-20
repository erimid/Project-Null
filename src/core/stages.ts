/**
 * Contracts with stages. A contract is a chain of steps, each with its own
 * target and goal. The first step is the contract's own targetId and
 * objective; `stages` holds the rest. Finishing a step starts the next:
 * the client may write with a new brief, and the world may change (a file
 * moves, a target puts its guard up). Only the last step is delivered.
 */
import type { ContractDef, ObjectiveDef, StageDef, TwistDef } from '../content/schema';
import { evidenceCount } from './forensics';
import { CLIENT_FILE, type GameState } from './state';
import { fileDef, findServer, securityOf, sendMail, type Content } from './world';

/** How long a server stays on its guard after a stage twist, in game hours. */
export const ALERT_HOURS = 48;

/** Every step of a contract, the first included. */
export function stagesOf(contract: ContractDef): StageDef[] {
  return [
    {
      targetId: contract.targetId,
      objective: contract.objective,
      ...(contract.withinMinutes ? { withinMinutes: contract.withinMinutes } : {}),
      ...(contract.twists ? { twists: contract.twists } : {}),
    },
    ...(contract.stages ?? []),
  ];
}

/**
 * How dangerous a contract looks from the board, 0 to 5: the strongest
 * security layer on any server it sends the player to, as that server
 * stands right now. A rough read for a job card; a Scanner gives the
 * layers one by one.
 */
export function contractRisk(state: GameState, content: Content, contract: ContractDef): number {
  let risk = 0;
  for (const targetId of new Set(stagesOf(contract).map((stage) => stage.targetId))) {
    const server = findServer(content, targetId);
    if (!server) continue;
    const { password, proxy, firewall, monitor } = securityOf(state, server);
    risk = Math.max(risk, password, proxy, firewall, monitor);
  }
  return risk;
}

/** True for the contract being worked on. */
const isActive = (state: GameState, contract: ContractDef) => state.contracts.activeId === contract.id;

/** Which step of a contract is being worked on: the saved one if it is active, else the first. */
export function stageIndex(state: GameState, contract: ContractDef): number {
  if (!isActive(state, contract)) return 0;
  return Math.max(0, Math.min(stagesOf(contract).length - 1, state.contracts.stage));
}

export function currentStage(state: GameState, contract: ContractDef): StageDef {
  return stagesOf(contract)[stageIndex(state, contract)]!;
}

/** The contract as its current step sees it: the same contract with that step's target and goal. */
export function stageView(state: GameState, contract: ContractDef): ContractDef {
  const stage = currentStage(state, contract);
  return { ...contract, targetId: stage.targetId, objective: stage.objective };
}

/** The flag that records the player has read a file. */
export const readFlag = (serverId: string, name: string) => `read:${serverId}/${name}`;

/** True once one step's goal is done. */
export function goalMet(state: GameState, content: Content, targetId: string, goal: ObjectiveDef): boolean {
  const target = state.servers[targetId];
  switch (goal.kind) {
    case 'steal':
      // A client can't use a file they can't read.
      return state.player.files.some((file) => file.name === goal.file && file.from === targetId && !file.encrypted);
    case 'destroy':
      return target !== undefined && !target.files.some((file) => file.name === goal.file);
    case 'record': {
      const column = findServer(content, targetId)?.records?.columns.indexOf(goal.column) ?? -1;
      return target?.records.find((row) => row[0] === goal.key)?.[column] === goal.value;
    }
    case 'read':
      return state.flags.includes(readFlag(targetId, goal.file));
    case 'plant':
      return target?.files.some((file) => file.name === goal.file) ?? false;
    case 'frame':
      // A false trail only holds once nothing of the player's own is left beside it.
      return (target?.logs.some((entry) => entry.framed === goal.who) ?? false) && evidenceCount(state, targetId) === 0;
  }
}

/** True if a step can still be done (e.g. the file to copy or read has not been deleted). */
export function goalPossible(state: GameState, content: Content, targetId: string, goal: ObjectiveDef): boolean {
  if (goalMet(state, content, targetId, goal)) return true;
  if (goal.kind === 'steal' || goal.kind === 'read') return state.servers[targetId]?.files.some((file) => file.name === goal.file) ?? false;
  // The file to plant must still be on the gateway.
  if (goal.kind === 'plant') return state.player.files.some((file) => file.name === goal.file && file.from === CLIENT_FILE);
  return true;
}

/** Puts a server on its guard: layers up or a layer run from elsewhere, for a while. */
function applyTwist(state: GameState, content: Content, targetId: string, twist: TwistDef): void {
  const server = state.servers[targetId];
  if (!server) return;
  const now = state.clock.gameTimeMs;
  const untilMs = now + ALERT_HOURS * 3_600_000;
  const alert = server.alert && server.alert.untilMs > now ? server.alert : { raise: {}, untilMs };
  alert.untilMs = Math.max(alert.untilMs, untilMs);
  switch (twist.kind) {
    case 'raise':
      alert.raise[twist.layer] = (alert.raise[twist.layer] ?? 0) + twist.by;
      server.alert = alert;
      return;
    case 'link':
      alert.link = { serverId: twist.fromId, layer: twist.layer };
      server.alert = alert;
      return;
    case 'drop':
      if (server.files.some((file) => file.name === twist.file)) return;
      server.files.push({
        name: twist.file,
        sizeGq: twist.sizeGq,
        access: 'admin',
        ...(twist.folder ? { folder: twist.folder } : {}),
        ...(twist.text ? { text: twist.text } : {}),
      });
      return;
    case 'move': {
      const from = state.servers[twist.fromId];
      const moving = from?.files.find((file) => file.name === twist.file);
      const written = fileDef(content, twist.fromId, twist.file);
      if (from) from.files = from.files.filter((file) => file !== moving);
      if (server.files.some((file) => file.name === twist.file)) return;
      server.files.push({
        name: twist.file,
        sizeGq: moving?.sizeGq ?? written?.sizeGq ?? 1,
        access: 'admin',
        folder: 'incoming',
        ...(moving?.encrypted ? { encrypted: moving.encrypted } : {}),
        ...(moving?.text ? { text: moving.text } : {}),
      });
      return;
    }
  }
}

/** Starts a step: what the client sends, what changes in the world, and the client's note. */
function beginStage(state: GameState, content: Content, contract: ContractDef, index: number): void {
  const stage = stagesOf(contract)[index];
  if (!stage) return;
  state.contracts.stage = index;
  state.contracts.stageStartMs = state.clock.gameTimeMs;
  for (const twist of stage.twists ?? []) applyTwist(state, content, stage.targetId, twist);
  const goal = stage.objective;
  if (goal.kind === 'plant' && !state.player.files.some((file) => file.name === goal.file)) {
    state.player.files.push({ name: goal.file, sizeGq: goal.sizeGq, from: CLIENT_FILE });
  }
  // The next server's address comes with the brief.
  if (!state.knownServers.includes(stage.targetId) && findServer(content, stage.targetId)) state.knownServers.push(stage.targetId);
  if (index > 0) {
    const of = stagesOf(contract).length;
    sendMail(state, content, 'stageNote', {
      client: contract.client,
      title: contract.title,
      step: String(index + 1),
      of: String(of),
      brief: stage.brief ?? 'That part is done. On to the next.',
    });
  }
}

/** Starts the first step of a contract the player has just taken. */
export function startContract(state: GameState, content: Content, contract: ContractDef): void {
  beginStage(state, content, contract, 0);
}

/** Takes back what a client sent for planting that was never planted. */
export function clearClientFiles(state: GameState): void {
  state.player.files = state.player.files.filter((file) => file.from !== CLIENT_FILE);
}

/** What finishing one step leaves the player with: a login read in a file. */
function finishStage(state: GameState, content: Content, stage: StageDef): void {
  const goal = stage.objective;
  if (goal.kind !== 'read' || !goal.reveals) return;
  const { serverId, user } = goal.reveals;
  const known = (state.player.passwords[serverId] ??= []);
  if (!known.includes(user)) known.push(user);
  if (!state.knownServers.includes(serverId) && findServer(content, serverId)) state.knownServers.push(serverId);
}

/** When the current step must be done by, if it has a time limit. */
export function stageDeadline(state: GameState, contract: ContractDef): number | undefined {
  const minutes = currentStage(state, contract).withinMinutes;
  return minutes === undefined ? undefined : state.contracts.stageStartMs + minutes * 60_000;
}

/**
 * Moves the active contract on: each finished step starts the next, and a
 * step past its time limit loses the contract. Safe to call any time.
 * Returns true if the contract was lost.
 */
export function advanceContract(state: GameState, content: Content, contract: ContractDef): boolean {
  const steps = stagesOf(contract);
  for (let guard = 0; guard < steps.length; guard++) {
    const index = stageIndex(state, contract);
    const stage = steps[index]!;
    if (!goalMet(state, content, stage.targetId, stage.objective)) {
      const deadline = stageDeadline(state, contract);
      if (deadline !== undefined && state.clock.gameTimeMs > deadline) {
        state.contracts.activeId = null;
        state.contracts.jobs = state.contracts.jobs.filter((job) => job.id !== contract.id);
        clearClientFiles(state);
        sendMail(state, content, 'contractLate', { client: contract.client, title: contract.title });
        return true;
      }
      return false;
    }
    finishStage(state, content, stage);
    if (index >= steps.length - 1) return false;
    beginStage(state, content, contract, index + 1);
  }
  return false;
}
