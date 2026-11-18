import { useState } from 'preact/hooks';
import { ownedProgram, traceReport } from '../../../core';
import { findServer, gatewayOf, type ServerDef } from '../../../core/content';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { Globe, type GlobeArc, type GlobeDot } from '../../globe/Globe';
import { activeConnection, deskStore, useDesk } from '../deskStore';
import { Window } from '../Window';
import { windows } from '../windowStore';

const KIND_LABELS: Record<ServerDef['kind'], string> = {
  gateway: 'Your gateway',
  directory: 'Public directory',
  board: 'Contracts board',
  relay: 'Open relay',
  company: 'Company server',
};

const byId = (id: string) => findServer(content, id);

/**
 * The route map: the globe with every server you have the address of.
 * Pick servers to build a bounce chain, then connect through it.
 */
export function MapWindow() {
  const desk = useDesk();
  const game = useWorld((state) => state);
  const [notice, setNotice] = useState('');

  const gateway = gatewayOf(content);
  const known = game.knownServers.map(byId).filter((server): server is ServerDef => server !== undefined);
  const selected = desk.selectedServerId ? byId(desk.selectedServerId) : undefined;
  const live = activeConnection(game, desk);

  // While connected, the map shows the live connection's route; otherwise the one being planned.
  const routeIds = live ? live.route : game.route;
  const targetId = live ? live.serverId : selected && selected.id !== gateway.id && !game.route.includes(selected.id) ? selected.id : null;
  const chain = [gateway, ...routeIds.map(byId), targetId ? byId(targetId) : undefined].filter(
    (server): server is ServerDef => server !== undefined,
  );

  // A running trace turns the target red. With a Trace Tracker, the legs it has already followed turn red too.
  const traced = live?.trace.status === 'active';
  const tracker = ownedProgram(game, content, 'traceTracker') !== undefined;
  const legsTraced = live && traced && tracker ? traceReport(live.trace).relaysTraced : 0;
  const legCount = chain.length - 1;
  /** True for the target of a running trace and for each relay the trace has already got past. */
  const isTraced = (id: string) => {
    if (!live || !traced) return false;
    const hop = live.route.indexOf(id);
    return id === live.serverId || (hop >= 0 && hop >= live.route.length - legsTraced);
  };

  const arcs: GlobeArc[] = chain.slice(1).map((server, index) => {
    const isLastLeg = index === legCount - 1 && targetId !== null;
    const found = index >= legCount - legsTraced;
    return { from: chain[index]!, to: server, tone: found ? 'red' : !live && isLastLeg ? 'cyan' : 'mint', dashed: !live };
  });

  const dots: GlobeDot[] = known.map((server) => {
    const hop = routeIds.indexOf(server.id);
    const onRoute = server.id === gateway.id || hop >= 0 || live?.serverId === server.id;
    return {
      id: server.id,
      name: server.name,
      lat: server.lat,
      lon: server.lon,
      tone: isTraced(server.id) ? 'red' : onRoute ? 'mint' : 'cyan',
      label: server.id === gateway.id ? 'YOU' : hop >= 0 ? String(hop + 1) : live?.serverId === server.id ? server.hostname : undefined,
      selected: server.id === selected?.id,
    };
  });

  const run = (action: Parameters<typeof session.dispatch>[0]) => {
    const result = session.dispatch(action);
    setNotice(result.ok ? '' : result.reason);
    return result.ok;
  };

  const connect = (server: ServerDef) => {
    if (!run({ type: 'connect', serverId: server.id })) return;
    const opened = session.getState().connections.at(-1);
    if (opened) deskStore.activate(opened.id);
    windows.focus('server');
  };

  const pick = (id: string) => {
    setNotice('');
    deskStore.select(id);
  };

  const inRoute = selected ? game.route.includes(selected.id) : false;
  const connectedTo = selected ? game.connections.some((c) => c.serverId === selected.id) : false;
  const note = live
    ? `${traced ? 'being traced' : 'connected'} · ${live.route.length === 0 ? 'direct' : `${live.route.length} ${live.route.length === 1 ? 'relay' : 'relays'}`}`
    : game.route.length === 0
      ? 'no relays planned'
      : `${game.route.length} ${game.route.length === 1 ? 'relay' : 'relays'} planned`;

  return (
    <Window id="map" note={note}>
      <div class="map">
        <div class="map__globe">
          <Globe dots={dots} arcs={arcs} focus={selected ?? null} onPick={pick} />
        </div>

        <div class="map__side">
          <h3 class="map__heading">Address book</h3>
          <ul class="addresses">
            {known.map((server) => {
              const hop = game.route.indexOf(server.id);
              const isLive = game.connections.some((c) => c.serverId === server.id);
              return (
                <li key={server.id}>
                  <button
                    type="button"
                    class={`address${server.id === selected?.id ? ' is-selected' : ''}`}
                    aria-pressed={server.id === selected?.id}
                    onClick={() => pick(server.id)}
                  >
                    <span class="address__name">{server.name}</span>
                    <span class="address__tag">
                      {server.id === gateway.id ? 'you' : isLive ? 'connected' : hop >= 0 ? `relay ${hop + 1}` : server.city}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <div class="map__detail">
              <div class="map__detail-name">{selected.name}</div>
              <div class="map__detail-kind">
                {KIND_LABELS[selected.kind]} · {selected.city}, {selected.country}
              </div>
              <div class="data map__detail-address">{selected.address}</div>
              <p class="map__detail-blurb">{selected.blurb}</p>
              {selected.id !== gateway.id && (
                <div class="map__actions">
                  {inRoute ? (
                    <button type="button" class="btn" disabled={!!live} onClick={() => run({ type: 'removeHop', serverId: selected.id })}>
                      Remove from route
                    </button>
                  ) : (
                    <button
                      type="button"
                      class="btn"
                      disabled={!!live || connectedTo}
                      onClick={() => run({ type: 'addHop', serverId: selected.id })}
                    >
                      Add as relay
                    </button>
                  )}
                  {connectedTo ? (
                    <button type="button" class="btn btn--go" onClick={() => windows.focus('server')}>
                      Show server
                    </button>
                  ) : (
                    <button type="button" class="btn btn--go" disabled={inRoute} onClick={() => connect(selected)}>
                      Connect
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p class="map__hint">Pick a server on the globe or in the list.</p>
          )}
          {notice && (
            <p class="map__notice" role="status">
              {notice}
            </p>
          )}
        </div>

        <div class="route">
          <span class="route__label">{live ? 'Live route' : 'Planned route'}</span>
          <ol class="route__chain">
            {chain.map((server, index) => (
              <li
                key={server.id}
                class={`route__hop${index === chain.length - 1 && targetId ? ' route__hop--target' : ''}${
                  isTraced(server.id) ? ' route__hop--traced' : ''
                }`}
              >
                {server.id === gateway.id ? 'You' : server.name}
              </li>
            ))}
            {!targetId && <li class="route__hop route__hop--empty">pick a target</li>}
          </ol>
          {!live && game.route.length > 0 && (
            <button type="button" class="btn" onClick={() => run({ type: 'clearRoute' })}>
              Clear
            </button>
          )}
        </div>
      </div>
    </Window>
  );
}
