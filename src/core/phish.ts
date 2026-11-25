/**
 * Phishing: writing to someone as somebody they trust, and mentioning
 * the things that person would know, to be told something useful. Who
 * to be and what to mention comes from reading files on servers.
 */
import type { AskDef, FactDef, FileRef, PersonDef } from '../content/people';
import type { GameState } from './state';
import { currentStage, readFlag } from './stages';
import { noteClue } from './story';
import { peopleOf } from './side';
import { findServer, securityOf, sendMail, type Content } from './world';

/** With a `state`, the people a job under way has put within reach count too (see side.ts). */
export const findPerson = (content: Content, id: string, state?: GameState): PersonDef | undefined =>
  peopleOf(content, state).people.find((person) => person.id === id);

export const findAsk = (content: Content, id: string, state?: GameState): AskDef | undefined => peopleOf(content, state).asks.find((ask) => ask.id === id);

/** True if the player has come across this person. */
export function knowsPerson(state: GameState, person: PersonDef): boolean {
  return person.source === undefined || state.player.contacts.includes(person.id);
}

export function knownPeople(state: GameState, content: Content): PersonDef[] {
  return peopleOf(content, state).people.filter((person) => knowsPerson(state, person));
}

export function knownFacts(state: GameState, content: Content): FactDef[] {
  return peopleOf(content, state).facts.filter((fact) => state.player.facts.includes(fact.id));
}

const sameFile = (a: FileRef, serverId: string, name: string) => a.serverId === serverId && a.file === name;

/** True if the player can read this file right now: a readable copy at home, or the file open to them over a connection. */
export function canRead(state: GameState, content: Content, serverId: string, name: string): boolean {
  const own = state.player.files.find((file) => file.name === name && file.from === serverId);
  if (own) return !own.encrypted;
  const file = state.servers[serverId]?.files.find((item) => item.name === name);
  const server = findServer(content, serverId);
  const connection = state.connections.find((item) => item.serverId === serverId);
  if (!file || !server || !connection || connection.user === null || file.encrypted) return false;
  if (file.access === 'admin' && connection.role !== 'admin') return false;
  return securityOf(state, server).firewall === 0 || connection.bypassed.firewall;
}

/** What one file has to teach: the people it names and the details in it. */
export function fileNotes(content: Content, serverId: string, name: string, state?: GameState): { people: PersonDef[]; facts: FactDef[] } {
  const all = peopleOf(content, state);
  return {
    people: all.people.filter((person) => person.source && sameFile(person.source, serverId, name)),
    facts: all.facts.filter((fact) => sameFile(fact.source, serverId, name)),
  };
}

/** Notes what a file has to teach. Returns how many new things were learned. */
function learnFrom(state: GameState, content: Content, serverId: string, name: string): number {
  const notes = fileNotes(content, serverId, name, state);
  let learned = 0;
  for (const person of notes.people) {
    if (!state.player.contacts.includes(person.id)) {
      state.player.contacts.push(person.id);
      learned++;
    }
  }
  for (const fact of notes.facts) {
    if (!state.player.facts.includes(fact.id)) {
      state.player.facts.push(fact.id);
      learned++;
    }
  }
  return learned;
}

/** Remembers that a file has been read, if the step of the contract under way wants it read. */
function noteRead(state: GameState, content: Content, serverId: string, name: string): void {
  const id = state.contracts.activeId;
  const contract = id === null ? undefined : (content.contracts.find((item) => item.id === id) ?? state.contracts.jobs.find((job) => job.id === id));
  if (!contract) return;
  const stage = currentStage(state, contract);
  const goal = stage.objective;
  if (stage.targetId !== serverId || !((goal.kind === 'read' && goal.file === name) || (goal.kind === 'leak' && goal.files.includes(name)))) return;
  const flag = readFlag(serverId, name);
  if (!state.flags.includes(flag)) state.flags.push(flag);
}

/** The player opened a file. Returns a reason if they can't read it. */
export function readFile(state: GameState, content: Content, serverId: string, name: string): string | null {
  if (!canRead(state, content, serverId, name)) return 'You cannot read that file from here.';
  learnFrom(state, content, serverId, name);
  noteRead(state, content, serverId, name);
  noteClue(state, content, serverId, name);
  return null;
}

/**
 * Reads every file the connection can open in one go. Returns how many
 * new people and details were noted.
 */
export function readEverything(state: GameState, content: Content, serverId: string): number {
  let learned = 0;
  for (const file of state.servers[serverId]?.files ?? []) {
    if (!canRead(state, content, serverId, file.name)) continue;
    learned += learnFrom(state, content, serverId, file.name);
    noteRead(state, content, serverId, file.name);
    noteClue(state, content, serverId, file.name);
  }
  return learned;
}

/** How a person stands with the player. */
export type Standing = 'open' | 'waiting' | 'wary' | 'burned';

export function standing(state: GameState, content: Content, markId: string): Standing {
  if ((state.phish.strikes[markId] ?? 0) >= content.rules.phishStrikes) return 'burned';
  if (state.phish.sent.some((attempt) => findAsk(content, attempt.askId, state)?.markId === markId)) return 'waiting';
  if (state.clock.gameTimeMs < (state.phish.waryUntilMs[markId] ?? 0)) return 'wary';
  return 'open';
}

/** The things the player could still ask this person for. */
export function openAsks(state: GameState, content: Content, markId: string): AskDef[] {
  return peopleOf(content, state).asks.filter((ask) => ask.markId === markId && !state.phish.done.includes(ask.id));
}

/** People the player knows of who still have something to give. */
export function marks(state: GameState, content: Content): PersonDef[] {
  return knownPeople(state, content).filter((person) => openAsks(state, content, person.id).length > 0);
}

export interface Draft {
  readonly askId: string;
  readonly senderId: string;
  readonly factIds: readonly string[];
}

/** What is wrong with a message, if anything. Only a rented model tells the player this. */
export type Verdict = 'good' | 'sender' | 'details';

export function judge(content: Content, draft: Draft, state?: GameState): Verdict {
  const ask = findAsk(content, draft.askId, state);
  if (!ask || ask.senderId !== draft.senderId) return 'sender';
  return ask.needs.every((need) => draft.factIds.includes(need)) ? 'good' : 'details';
}

/** Sends a message. The answer comes later. Returns a reason if it can't be sent. */
export function sendPhish(state: GameState, content: Content, draft: Draft): string | null {
  const ask = findAsk(content, draft.askId, state);
  const mark = ask && findPerson(content, ask.markId, state);
  const sender = findPerson(content, draft.senderId, state);
  if (!ask || !mark || !knowsPerson(state, mark) || state.phish.done.includes(ask.id)) return 'There is nothing to ask for there.';
  if (!sender || !knowsPerson(state, sender) || sender.id === mark.id) return 'You cannot write as that person.';
  const facts = [...new Set(draft.factIds)];
  if (facts.length > content.rules.phishMaxDetails) return `A message can mention at most ${content.rules.phishMaxDetails} details.`;
  if (!facts.every((id) => state.player.facts.includes(id))) return 'You do not know that detail.';
  switch (standing(state, content, mark.id)) {
    case 'burned':
      return `${mark.name} will not answer you again.`;
    case 'waiting':
      return `You are still waiting for ${mark.name} to answer.`;
    case 'wary':
      return `${mark.name} is on guard. Give it some hours.`;
    case 'open':
  }
  state.phish.sent.push({
    askId: ask.id,
    dueMs: state.clock.gameTimeMs + content.rules.phishReplyMinutes * 60_000,
    ok: judge(content, { ...draft, factIds: facts }, state) === 'good',
  });
  return null;
}

function deliver(state: GameState, ask: AskDef, mark: PersonDef): void {
  const reward = ask.reward;
  if (reward.kind === 'password') {
    const known = (state.player.passwords[reward.serverId] ??= []);
    if (!known.includes(reward.user)) known.push(reward.user);
  } else if (!state.knownServers.includes(reward.serverId)) {
    state.knownServers.push(reward.serverId);
  }
  state.phish.done.push(ask.id);
  state.messages.push({
    id: `m${state.nextId++}`,
    from: mark.name,
    subject: `Re: ${ask.label}`,
    body: ask.reply,
    timeMs: state.clock.gameTimeMs,
    read: false,
  });
}

/** Answers every message whose reply has come due. */
export function runPhish(state: GameState, content: Content): void {
  const due = state.phish.sent.filter((attempt) => attempt.dueMs <= state.clock.gameTimeMs);
  if (due.length === 0) return;
  state.phish.sent = state.phish.sent.filter((attempt) => !due.includes(attempt));
  for (const attempt of due) {
    const ask = findAsk(content, attempt.askId, state);
    const mark = ask && findPerson(content, ask.markId, state);
    if (!ask || !mark) continue;
    if (attempt.ok) {
      deliver(state, ask, mark);
      continue;
    }
    const strikes = (state.phish.strikes[mark.id] = (state.phish.strikes[mark.id] ?? 0) + 1);
    const fill = { name: mark.name, title: mark.title, label: ask.label };
    if (strikes < content.rules.phishStrikes) {
      state.phish.waryUntilMs[mark.id] = state.clock.gameTimeMs + content.rules.phishWaryHours * 3_600_000;
      sendMail(state, content, 'phishRefused', { ...fill, hours: String(content.rules.phishWaryHours) });
    } else {
      // Reported. Their side changes its passwords, and word gets round.
      delete state.player.passwords[ask.reward.serverId];
      state.player.rating = Math.max(0, state.player.rating - content.rules.caughtRatingLoss);
      sendMail(state, content, 'phishReported', fill);
    }
  }
}

/** Something the player can still get by writing to someone they have found. */
export interface Leads {
  /** Asks whose person the player knows and that are not done yet. */
  readonly open: AskDef[];
  /** Asks that have already paid off. */
  readonly done: AskDef[];
}

export function leads(state: GameState, content: Content): Leads {
  const known = (ask: AskDef) => {
    const mark = findPerson(content, ask.markId, state);
    return mark !== undefined && knowsPerson(state, mark);
  };
  return {
    open: peopleOf(content, state).asks.filter((ask) => known(ask) && !state.phish.done.includes(ask.id)),
    done: peopleOf(content, state).asks.filter((ask) => state.phish.done.includes(ask.id)),
  };
}

/** A set of things the player learned from one place. */
export interface Group<T> {
  /** Server the things came from, or null for things the player always knew. */
  readonly serverId: string | null;
  /** File they came from, if they all came from one. */
  readonly file: string | null;
  readonly items: T[];
}

/** Known details, grouped by the file they were read in, in the order the files were first met. */
export function factsByFile(state: GameState, content: Content): Group<FactDef>[] {
  const groups: Group<FactDef>[] = [];
  for (const fact of knownFacts(state, content)) {
    const group = groups.find((item) => item.serverId === fact.source.serverId && item.file === fact.source.file);
    if (group) group.items.push(fact);
    else groups.push({ serverId: fact.source.serverId, file: fact.source.file, items: [fact] });
  }
  return groups;
}

/**
 * The people the player could sign a message to this person as, grouped
 * by the server they were found on. People found on the same server as
 * the person being written to come first; people the player always knew
 * come last.
 */
export function sendersFor(state: GameState, content: Content, markId: string): Group<PersonDef>[] {
  const mark = findPerson(content, markId, state);
  const groups: Group<PersonDef>[] = [];
  for (const person of knownPeople(state, content)) {
    if (person.id === markId) continue;
    const serverId = person.source?.serverId ?? null;
    const group = groups.find((item) => item.serverId === serverId);
    if (group) group.items.push(person);
    else groups.push({ serverId, file: null, items: [person] });
  }
  const rank = (group: Group<PersonDef>) => (group.serverId === null ? 2 : group.serverId === mark?.source?.serverId ? 0 : 1);
  return groups.sort((a, b) => rank(a) - rank(b));
}
