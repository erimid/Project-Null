import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  deserializeGame,
  judge,
  knownFacts,
  knownPeople,
  marks,
  serializeGame,
  standing,
  syncWithContent,
  tick,
  type Action,
  type GameState,
} from './index';
import { content } from './testWorld';

/*
 * Test world reminders: the directory's readme (open to guests) names the
 * clerk and holds the door code. Corp's secret.dat (admin, behind a
 * firewall) names the boss and holds two details. The clerk gives the
 * vault password to the boss for the audit and the dog, and the board's
 * address for the door code. Replies take 30 minutes; a message holds two
 * details; a refusal lasts 4 hours; the second one is reported.
 */

function game() {
  const state: GameState = syncWithContent(
    createGame({ seed: 3, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 100 }),
    content,
  );
  state.knownServers = content.servers.filter((server) => server.id !== 'hidden').map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  /** Minutes of game time, with nothing connected. */
  const minutes = (count: number) => tick(state, count * 1000, content);
  const readReadme = () => {
    ok({ type: 'connect', serverId: 'directory' });
    const id = state.connections[0]!.id;
    ok({ type: 'login', connectionId: id, user: 'guest' });
    ok({ type: 'readFile', serverId: 'directory', name: 'readme.txt' });
    ok({ type: 'disconnect', connectionId: id });
  };
  const subjects = () => state.messages.map((message) => message.subject);
  return { state, ok, refused, minutes, readReadme, subjects };
}

const learnAll = (state: GameState) => {
  state.player.contacts = ['clerk', 'boss'];
  state.player.facts = ['door', 'audit', 'dog'];
};

describe('reading files', () => {
  it('notes the people a file names and the details in it', () => {
    const h = game();
    expect(knownPeople(h.state, content).map((person) => person.id)).toEqual(['fixer']);
    h.readReadme();
    expect(knownPeople(h.state, content).map((person) => person.id)).toEqual(['fixer', 'clerk']);
    expect(knownFacts(h.state, content).map((fact) => fact.id)).toEqual(['door']);
    expect(marks(h.state, content).map((person) => person.id)).toEqual(['clerk']);
  });

  it('needs the file to be readable: logged in, allowed, past the firewall, or a copy at home', () => {
    const h = game();
    h.refused({ type: 'readFile', serverId: 'directory', name: 'readme.txt' }, /cannot read/);
    h.state.player.passwords.corp = ['admin'];
    h.ok({ type: 'connect', serverId: 'corp' });
    const id = h.state.connections[0]!.id;
    h.refused({ type: 'readFile', serverId: 'corp', name: 'secret.dat' }, /cannot read/);
    h.ok({ type: 'login', connectionId: id, user: 'admin' });
    h.refused({ type: 'readFile', serverId: 'corp', name: 'secret.dat' }, /cannot read/);
    h.state.connections[0]!.bypassed.firewall = true;
    h.ok({ type: 'readFile', serverId: 'corp', name: 'secret.dat' });
    expect(h.state.player.facts).toEqual(['audit', 'dog']);

    const home = game();
    home.state.player.files.push({ name: 'secret.dat', sizeGq: 5, from: 'corp', encrypted: 1 });
    home.refused({ type: 'readFile', serverId: 'corp', name: 'secret.dat' }, /cannot read/);
    delete home.state.player.files[0]!.encrypted;
    home.ok({ type: 'readFile', serverId: 'corp', name: 'secret.dat' });
    expect(home.state.player.contacts).toEqual(['boss']);
  });
});

describe('writing to someone', () => {
  it('gets a password from the right name with the right details, after a while', () => {
    const h = game();
    learnAll(h.state);
    h.ok({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit'] });
    expect(standing(h.state, content, 'clerk')).toBe('waiting');
    h.refused({ type: 'sendPhish', askId: 'where', senderId: 'boss', factIds: ['door'] }, /still waiting/);
    h.minutes(29);
    expect(h.state.player.passwords.vault).toBeUndefined();
    h.minutes(1);
    expect(h.state.player.passwords.vault).toEqual(['admin']);
    expect(h.state.messages.at(-1)).toMatchObject({ from: 'Clerk', subject: 'Re: Password reset', body: 'Done. It is hunter2.' });
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit'] }, /nothing to ask/);
  });

  it('gets the address of an unlisted server', () => {
    const h = game();
    learnAll(h.state);
    h.ok({ type: 'sendPhish', askId: 'where', senderId: 'boss', factIds: ['door'] });
    h.minutes(30);
    expect(h.state.knownServers).toContain('hidden');
    expect(marks(h.state, content).map((person) => person.id)).toEqual(['clerk']);
  });

  it('is refused the first time it is wrong, and reported the second', () => {
    const h = game();
    learnAll(h.state);
    h.state.player.rating = 3;
    h.state.player.passwords.vault = ['admin'];
    // The wrong name.
    h.ok({ type: 'sendPhish', askId: 'reset', senderId: 'fixer', factIds: ['dog', 'audit'] });
    h.minutes(30);
    expect(h.subjects().at(-1)).toBe('Refused: Password reset');
    expect(standing(h.state, content, 'clerk')).toBe('wary');
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit'] }, /on guard/);
    h.minutes(4 * 60);
    // The right name, but a detail missing.
    h.ok({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'door'] });
    h.minutes(30);
    expect(h.subjects().at(-1)).toBe('Reported by Clerk');
    expect(standing(h.state, content, 'clerk')).toBe('burned');
    expect(h.state.player.rating).toBe(2);
    expect(h.state.player.passwords.vault).toBeUndefined();
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit'] }, /will not answer/);
  });

  it('only uses people and details the player has come across, and no more than fit', () => {
    const h = game();
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: [] }, /nothing to ask/);
    h.state.player.contacts = ['clerk'];
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: [] }, /cannot write as/);
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'clerk', factIds: [] }, /cannot write as/);
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'fixer', factIds: ['dog'] }, /do not know/);
    learnAll(h.state);
    h.refused({ type: 'sendPhish', askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit', 'door'] }, /at most 2/);
  });

  it('can be judged before it is sent', () => {
    expect(judge(content, { askId: 'reset', senderId: 'boss', factIds: ['dog', 'audit'] })).toBe('good');
    expect(judge(content, { askId: 'reset', senderId: 'fixer', factIds: ['dog', 'audit'] })).toBe('sender');
    expect(judge(content, { askId: 'reset', senderId: 'boss', factIds: ['dog'] })).toBe('details');
  });
});

describe('saves and progress', () => {
  it('keep a message that is waiting for its answer', () => {
    const h = game();
    learnAll(h.state);
    h.ok({ type: 'sendPhish', askId: 'where', senderId: 'boss', factIds: ['door'] });
    const loaded = syncWithContent(deserializeGame(serializeGame(h.state, 'now')).state, content);
    tick(loaded, 30 * 1000, content);
    expect(loaded.knownServers).toContain('hidden');
  });

  it('load a version 6 save with nobody known and nothing sent', () => {
    const h = game();
    const file = JSON.parse(serializeGame(h.state, 'now'));
    file.version = 6;
    file.state.version = 6;
    delete file.state.phish;
    delete file.state.player.contacts;
    delete file.state.player.facts;
    const loaded = deserializeGame(JSON.stringify(file)).state;
    expect(loaded.version).toBe(7);
    expect(loaded.player).toMatchObject({ contacts: [], facts: [] });
    expect(loaded.phish).toEqual({ sent: [], strikes: {}, waryUntilMs: {}, done: [] });
  });

  it('send the note about writing to people once, after enough deliveries', () => {
    const h = game();
    h.state.contracts.completed = ['steal', 'destroy'];
    syncWithContent(h.state, content);
    syncWithContent(h.state, content);
    expect(h.subjects().filter((subject) => subject === 'phishing')).toHaveLength(1);
  });
});
