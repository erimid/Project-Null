import { STATE_VERSION } from './state';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  deserializeGame,
  hasSkill,
  rentedModel,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type GameState,
} from './index';
import { content } from './testWorld';

/*
 * Test world reminders: Small costs 40 and reads and scrubs; Big costs 90
 * and also reviews and watches. A rental lasts 24 hours. A watching model
 * hangs up with 5 seconds of trace left. The vault traces on connect, 10s
 * a hop (relay A doubles it). The board is the unlisted "hidden" server.
 */

function game() {
  const state: GameState = syncWithContent(
    createGame({ seed: 4, handle: 'T', startDate: '2034-03-14T08:00:00Z', startingBalance: 200 }),
    content,
  );
  state.knownServers = content.servers.map((server) => server.id);
  const act = (action: Action) => applyAction(state, action, content);
  const ok = (action: Action) => expect(act(action)).toEqual({ ok: true });
  const refused = (action: Action, pattern: RegExp) => {
    const result = act(action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  };
  const login = (serverId: string, user: string) => {
    ok({ type: 'connect', serverId });
    const id = state.connections[0]!.id;
    ok({ type: 'login', connectionId: id, user });
    return id;
  };
  const rent = (modelId: string) => {
    const id = login('hidden', 'member');
    ok({ type: 'rentModel', connectionId: id, modelId });
    ok({ type: 'disconnect', connectionId: id });
  };
  return { state, ok, refused, login, rent };
}

describe('renting a model', () => {
  it('costs its price, lasts a day, and is extended by renting it again', () => {
    const h = game();
    expect(rentedModel(h.state, content)).toBeUndefined();
    const id = h.login('hidden', 'member');
    const now = h.state.clock.gameTimeMs;
    h.ok({ type: 'rentModel', connectionId: id, modelId: 'small' });
    expect(h.state.player.balance).toBe(160);
    expect(h.state.player.model).toEqual({ id: 'small', untilMs: now + 24 * 3_600_000 });
    expect(hasSkill(h.state, content, 'read')).toBe(true);
    expect(hasSkill(h.state, content, 'watch')).toBe(false);
    h.ok({ type: 'rentModel', connectionId: id, modelId: 'small' });
    expect(h.state.player.model!.untilMs).toBe(now + 48 * 3_600_000);
    // A different model starts now and replaces it.
    h.ok({ type: 'rentModel', connectionId: id, modelId: 'big' });
    expect(h.state.player.model).toEqual({ id: 'big', untilMs: now + 24 * 3_600_000 });
    expect(h.state.player.balance).toBe(30);
    h.refused({ type: 'rentModel', connectionId: id, modelId: 'big' }, /cannot afford/);
    h.refused({ type: 'rentModel', connectionId: id, modelId: 'huge' }, /not for rent/);
  });

  it('is only possible on the board', () => {
    const h = game();
    const id = h.login('directory', 'guest');
    h.refused({ type: 'rentModel', connectionId: id, modelId: 'small' }, /board/);
  });

  it('runs out, with a message, and survives a save until then', () => {
    const h = game();
    h.rent('small');
    const loaded = syncWithContent(deserializeGame(serializeGame(h.state, 'now')).state, content);
    expect(rentedModel(loaded, content)?.id).toBe('small');
    loaded.clock.speed = 4;
    for (let i = 0; i < 24 * 60 * 4; i++) tick(loaded, 250, content);
    expect(loaded.player.model).toBeNull();
    expect(loaded.messages.at(-1)!.subject).toBe('Ended: Small');
  });
});

describe('what a model does', () => {
  it('reads every file the connection can open in one go', () => {
    const h = game();
    const id = h.login('directory', 'guest');
    h.refused({ type: 'modelRead', connectionId: id }, /no model/);
    h.ok({ type: 'disconnect', connectionId: id });
    h.rent('small');
    h.ok({ type: 'modelRead', connectionId: h.login('directory', 'guest') });
    expect(h.state.player.contacts).toEqual(['clerk']);
    expect(h.state.player.facts).toEqual(['door']);
  });

  it('hangs up just before a trace completes, if it can watch', () => {
    const h = game();
    h.rent('big');
    h.ok({ type: 'addHop', serverId: 'relay-b' });
    h.ok({ type: 'connect', serverId: 'vault' });
    const balance = h.state.player.balance;
    for (let i = 0; i < 19; i++) tick(h.state, 250, content);
    expect(h.state.connections).toHaveLength(1);
    // Ten seconds to trace one plain relay; at five seconds left the model cuts the line.
    for (let i = 0; i < 2; i++) tick(h.state, 250, content);
    expect(h.state.connections).toEqual([]);
    expect(h.state.player.balance).toBe(balance);
    expect(h.state.player.lieLowUntilMs).toBe(0);
  });

  it('leaves the player to be caught if it cannot watch', () => {
    const h = game();
    h.rent('small');
    h.ok({ type: 'addHop', serverId: 'relay-b' });
    h.ok({ type: 'connect', serverId: 'vault' });
    for (let i = 0; i < 41; i++) tick(h.state, 250, content);
    expect(h.state.connections).toEqual([]);
    expect(h.state.player.lieLowUntilMs).toBeGreaterThan(0);
  });
});

describe('old saves', () => {
  it('load a version 7 save with no model rented', () => {
    const h = game();
    const file = JSON.parse(serializeGame(h.state, 'now'));
    file.version = 7;
    file.state.version = 7;
    delete file.state.player.model;
    const loaded = deserializeGame(JSON.stringify(file)).state;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.player.model).toBeNull();
  });
});
