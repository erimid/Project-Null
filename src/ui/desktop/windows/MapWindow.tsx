import { useState } from 'preact/hooks';
import { hopUnderTrace, legKind, maxReroutes, ownedProgram, traceLegs, traceReport, traceSlow, type LegKind } from '../../../core';
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

const LEG_WORDS: Record<LegKind, string> = { country: 'local', border: 'border', overseas: 'overseas' };
const LEG_TIPS: Record<LegKind, string> = {
  country: 'Both ends are in one country: a trace follows this hop quickly.',
  border: 'This hop crosses a border: a trace takes longer to follow it.',
  overseas: 'This hop crosses to another part of the world: a trace takes longest to follow it.',
};

const seconds = (ms: number) => {
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

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

  // Where each hop goes decides how long a trace needs to follow it. With a target picked, a Trace Tracker can say how long.
  const target = targetId ? byId(targetId) : undefined;
  const legs = target ? traceLegs(content, gateway.id, target, routeIds, traceSlow(game, content)) : undefined;
  const legKinds = chain.slice(1).map((server, index) => legKind(chain[index]!, server));
  const traceTotal = legs?.reduce((sum, leg) => sum + leg.ms, 0) ?? 0;
  const legLabel = (index: number) => {
    const isTargetLeg = targetId !== null && index === legCount - 1 && routeIds.length > 0;
    if (isTargetLeg) return undefined;
    const word = LEG_WORDS[legKinds[index]!].toUpperCase();
    const ms = legs?.[index]?.ms;
    return tracker && ms ? `${word} +${seconds(ms)}` : legKinds[index] === 'country' ? undefined : word;
  };

  const arcs: GlobeArc[] = chain.slice(1).map((server, index) => {
    const isLastLeg = index === legCount - 1 && targetId !== null;
    const found = index >= legCount - legsTraced;
    return {
      from: chain[index]!,
      to: server,
      tone: found ? 'red' : !live && isLastLeg ? 'cyan' : 'mint',
      dashed: !live,
      heavy: legKinds[index] === 'overseas',
      label: legLabel(index),
    };
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

  // During a trace, a spare server can take the place of the relay the trace is working on.
  const tracingHop = live ? hopUnderTrace(live) : -1;
  const tracingId = live && tracingHop >= 0 ? live.route[tracingHop] : undefined;
  const reroutesLeft = live ? maxReroutes(game, content) - live.reroutes : 0;
  const canReroute =
    !!live && !!selected && tracingHop >= 0 && selected.id !== gateway.id && selected.id !== live.serverId && !live.route.includes(selected.id);

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
              const hop = routeIds.indexOf(server.id);
              const isLive = game.connections.some((c) => c.serverId === server.id);
              return (
                <li key={server.id} class="addresses__row">
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
                  {server.id !== gateway.id &&
                    (game.route.includes(server.id) ? (
                      <button
                        type="button"
                        class="address__relay is-on"
                        disabled={!!live}
                        aria-label={`Remove ${server.name} from the route`}
                        title={live ? 'Disconnect first to change the route' : undefined}
                        data-tip="Take this server out of your route"
                        onClick={() => run({ type: 'removeHop', serverId: server.id })}
                      >
                        −
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="address__relay"
                        disabled={!!live || isLive}
                        aria-label={`Add ${server.name} as a relay`}
                        title={live ? 'Disconnect first to change the route' : undefined}
                        data-tip="Add as a relay: your connection bounces through it, and a trace has one more step to follow"
                        onClick={() => run({ type: 'addHop', serverId: server.id })}
                      >
                        +
                      </button>
                    ))}
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
                  {canReroute && live ? (
                    <button
                      type="button"
                      class="btn btn--go"
                      disabled={reroutesLeft <= 0}
                      data-tip="Swap this server into the live route. The trace has to start its current step again."
                      onClick={() => run({ type: 'reroute', connectionId: live.id, serverId: selected.id })}
                    >
                      Reroute through here
                    </button>
                  ) : inRoute ? (
                    <button
                      type="button"
                      class="btn"
                      disabled={!!live}
                      data-tip="Take this server out of your route"
                      onClick={() => run({ type: 'removeHop', serverId: selected.id })}
                    >
                      Remove from route
                    </button>
                  ) : (
                    <button
                      type="button"
                      class="btn"
                      disabled={!!live || connectedTo}
                      data-tip="Bounce your connection through this server. Each relay gives a trace one more step to follow."
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
                    <button
                      type="button"
                      class="btn btn--go"
                      disabled={inRoute}
                      data-tip="Connect to this server through the relays in your route"
                      onClick={() => connect(selected)}
                    >
                      Connect
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p class="map__hint">Pick a server on the globe or in the list.</p>
          )}
          {live && tracingId && (
            <p class="map__reroute" role="status">
              The trace is working on <strong>{byId(tracingId)?.name}</strong>.{' '}
              {reroutesLeft > 0
                ? `Pick a spare server and reroute to make it start that step again. ${reroutesLeft} left on this connection.`
                : 'This connection cannot be rerouted again.'}
            </p>
          )}
          {notice && (
            <p class="map__notice" role="status">
              {notice}
            </p>
          )}
        </div>

        <div class="route">
          <span class="route__label" data-tip="The path your connection takes, from you to the target. A trace follows it back one step at a time.">
            {live ? 'Live route' : 'Planned route'}
          </span>
          <ol class="route__chain">
            {chain.map((server, index) => (
              <li
                key={server.id}
                class={`route__hop${index === chain.length - 1 && targetId ? ' route__hop--target' : ''}${
                  isTraced(server.id) ? ' route__hop--traced' : ''
                }${server.id === tracingId ? ' route__hop--tracing' : ''}`}
              >
                {index > 0 && (
                  <span class={`route__leg route__leg--${legKinds[index - 1]}`} data-tip={LEG_TIPS[legKinds[index - 1]!]}>
                    {legKinds[index - 1] === 'overseas' ? '»' : '›'}
                  </span>
                )}
                {server.id === gateway.id ? 'You' : server.name}
              </li>
            ))}
            {!targetId && <li class="route__hop route__hop--empty">pick a target</li>}
          </ol>
          {target && (
            <span
              class="route__time"
              data-tip={
                tracker
                  ? 'How long a trace would need to follow this route back to you. Hops across borders and oceans add the most.'
                  : 'A Trace Tracker would show how long a trace needs to follow this route. Hops across borders and oceans add the most.'
              }
            >
              Trace <span class="data">{tracker ? seconds(traceTotal) : '?'}</span>
            </span>
          )}
          {!live && game.route.length > 0 && (
            <button type="button" class="btn" data-tip="Remove every relay from the route" onClick={() => run({ type: 'clearRoute' })}>
              Clear
            </button>
          )}
        </div>
      </div>
    </Window>
  );
}
