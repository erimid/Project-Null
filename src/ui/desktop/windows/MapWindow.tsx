import { useEffect, useRef, useState } from 'preact/hooks';
import {
  PLANNER_HOPS,
  ROUTE_SLOTS,
  bestRoute,
  coverShortfall,
  holdsLogin,
  hopUnderTrace,
  legKind,
  maxReroutes,
  ownedProgram,
  relayCover,
  relayHeat,
  stepFade,
  traceLegs,
  traceReport,
  traceSlow,
  type LegKind,
} from '../../../core';
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

const PLANNER_TIPS: Record<number, string> = {
  1: 'It only knows how slow each relay is.',
  2: 'It reads borders and oceans.',
  3: 'It reads borders and oceans, and knows which relays are warm or seen through by your target.',
};

/** Small marks beside a server in the address book: a login held there, warmth from use, and a target that sees through it. */
function RelayMarks({ heat, short, login }: { heat: number; short: number; login: boolean }) {
  if (heat < 0.2 && short === 0 && !login) return null;
  return (
    <span class="address__marks">
      {login && (
        <span class="mark mark--login" data-tip="You hold a login here, so it covers you one level better as a relay">
          key
        </span>
      )}
      {heat >= 0.2 && (
        <span class={`mark ${heat >= 1.5 ? 'mark--hot' : 'mark--warm'}`} data-tip="Warm from recent use as a relay. It holds a trace up for less time until it cools.">
          {heat >= 1.5 ? 'hot' : 'warm'}
        </span>
      )}
      {short > 0 && (
        <span
          class={`mark ${short >= 2 ? 'mark--seen' : 'mark--thin'}`}
          data-tip={
            short >= 2
              ? "Your target's monitor sees straight through this relay. It will barely slow a trace."
              : "Your target's monitor is a level better than this relay's cover. It slows a trace about half as well."
          }
        >
          {short >= 2 ? 'seen through' : 'thin'}
        </span>
      )}
    </span>
  );
}

/** A line in the detail panel on what the picked server is worth as a relay. */
function RelayNote({
  server,
  cover,
  heat,
  short,
  login,
  target,
}: {
  server: ServerDef;
  cover: number;
  heat: number;
  short: number;
  login: boolean;
  target: ServerDef | undefined;
}) {
  const isTarget = target?.id === server.id;
  return (
    <p class="map__relay-note">
      {isTarget ? (
        <>
          As your target: its monitor is level <span class="data">{server.security.monitor}</span>. Relays with less cover than that hold its trace up
          for less time.
        </>
      ) : (
        <>
          As a relay: cover <span class="data">{cover}</span>
          {login ? ' (its monitor, plus your login)' : server.security.password > 0 ? ' (a login here would add 1)' : ''}
          {heat >= 0.2 ? `, ${heat >= 1.5 ? 'hot' : 'warm'} from use` : ', cool'}
          {target && short > 0 ? `. ${target.name} sees ${short >= 2 ? 'straight through it' : 'partly through it'}.` : '.'}
        </>
      )}
    </p>
  );
}

/** Ways to order the address book. Your own gateway always comes first. */
const SORTS = [
  { id: 'name', label: 'Name', tip: 'Sort by name, A to Z' },
  { id: 'place', label: 'Place', tip: 'Sort by country, then city' },
  { id: 'kind', label: 'Type', tip: 'Group boards, directories, relays and companies' },
] as const;
type SortId = (typeof SORTS)[number]['id'];
const SORT_KEY = 'project-null.book-sort.v1';
const KIND_ORDER: ServerDef['kind'][] = ['gateway', 'board', 'directory', 'relay', 'company'];

function savedSort(): SortId {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return SORTS.some((sort) => sort.id === value) ? (value as SortId) : 'name';
  } catch {
    return 'name';
  }
}

function sortServers(servers: readonly ServerDef[], sort: SortId): ServerDef[] {
  const name = (a: ServerDef, b: ServerDef) => a.name.localeCompare(b.name);
  const home = (server: ServerDef) => (server.kind === 'gateway' ? 0 : 1);
  return [...servers].sort((a, b) => {
    if (home(a) !== home(b)) return home(a) - home(b);
    if (sort === 'place') return a.country.localeCompare(b.country) || a.city.localeCompare(b.city) || name(a, b);
    if (sort === 'kind') return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || name(a, b);
    return name(a, b);
  });
}

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
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState<SortId>(savedSort);
  const chooseSort = (id: SortId) => {
    setSort(id);
    try {
      localStorage.setItem(SORT_KEY, id);
    } catch {
      // The order still holds for this visit.
    }
  };
  const book = useRef<HTMLUListElement>(null);
  // True while the next press on a slot keeps the planned route there.
  const [saving, setSaving] = useState(false);

  const gateway = gatewayOf(content);
  const known = game.knownServers.map(byId).filter((server): server is ServerDef => server !== undefined);
  // Starred servers come first. Both groups are in the order the player chose.
  const starred = (id: string) => game.bookmarks.includes(id);
  const listed = [
    ...sortServers(known.filter((server) => starred(server.id)), sort),
    ...(starredOnly ? [] : sortServers(known.filter((server) => !starred(server.id)), sort)),
  ];
  const selected = desk.selectedServerId ? byId(desk.selectedServerId) : undefined;
  const live = activeConnection(game, desk);
  // A server picked somewhere else (the globe, a contract) is brought into view in the list.
  useEffect(() => {
    // Scroll the list itself, never the window around it.
    const list = book.current;
    const row = list?.querySelector<HTMLElement>('.address.is-selected')?.closest<HTMLElement>('.addresses__row');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [desk.selectedServerId, sort, starredOnly]);

  // While connected, the map shows the live connection's route; otherwise the one being planned.
  // A picked server that is not a relay is the target. Picking a relay and pressing Connect takes it out of the route.
  const targetId = live ? live.serverId : selected && selected.id !== gateway.id && !game.route.includes(selected.id) ? selected.id : null;
  const routeIds = live ? live.route : game.route;
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
  // A planned route is worked out as the relays stand now. A live one keeps the times it was opened with.
  const planned = target ? traceLegs(content, gateway.id, target, routeIds, traceSlow(game, content), game) : undefined;
  const legs =
    live && planned && live.route.length > 0
      ? planned.map((leg, index) => (index < live.route.length ? { ...leg, ms: live.trace.hopMs[live.route.length - 1 - index] ?? leg.ms } : leg))
      : planned;

  /** What is worth knowing about a server as a relay: how warm it is, and whether the picked target sees through it. */
  const relayMarks = (server: ServerDef) => {
    const heat = relayHeat(game, content, server.id);
    const short = target && server.id !== target.id ? coverShortfall(game, target, server) : 0;
    return { heat, short, login: holdsLogin(game, server) };
  };
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
  // Fill route is offered while it would change something.
  // The server you have picked is the one you mean to connect to, so it stays out of the relays.
  const fillTarget = selected && selected.id !== gateway.id ? selected.id : null;
  const planner = ownedProgram(game, content, 'planRoute');
  const best = live || !planner ? [] : bestRoute(game, content, fillTarget, planner.version);
  const canFill = best.length > 0 && best.join() !== game.route.join();
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
          <div class="map__book-head">
            <h3 class="map__heading">Address book</h3>
            <div class="map__sort" role="group" aria-label="Sort the address book">
              {SORTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  class={`map__sort-btn${sort === option.id ? ' is-on' : ''}`}
                  aria-pressed={sort === option.id}
                  data-tip={option.tip}
                  onClick={() => chooseSort(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              class={`map__starred${starredOnly ? ' is-on' : ''}`}
              aria-pressed={starredOnly}
              data-tip="Show only the servers you have starred"
              onClick={() => setStarredOnly((on) => !on)}
            >
              ★ Starred {game.bookmarks.length > 0 && <span class="data">{game.bookmarks.length}</span>}
            </button>
          </div>
          <ul class="addresses" ref={book}>
            {starredOnly && listed.length === 0 && <li class="addresses__empty">Press ☆ next to a server to star it.</li>}
            {listed.map((server) => {
              const hop = routeIds.indexOf(server.id);
              const isLive = game.connections.some((c) => c.serverId === server.id);
              const star = starred(server.id);
              return (
                <li key={server.id} class={`addresses__row${star ? ' is-starred' : ''}`}>
                  <button
                    type="button"
                    class={`address__star${star ? ' is-on' : ''}`}
                    aria-pressed={star}
                    aria-label={star ? `Unstar ${server.name}` : `Star ${server.name}`}
                    data-tip={star ? 'Take this server off your starred list' : 'Star this server to keep it at the top of the list'}
                    onClick={() => run({ type: 'toggleBookmark', serverId: server.id })}
                  >
                    {star ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    class={`address${server.id === selected?.id ? ' is-selected' : ''}`}
                    aria-pressed={server.id === selected?.id}
                    onClick={() => pick(server.id)}
                  >
                    <span class="address__name">{server.name}</span>
                    {server.id !== gateway.id && <RelayMarks {...relayMarks(server)} />}
                    <span class="address__tag">
                      {server.id === gateway.id
                        ? 'you'
                        : isLive
                          ? 'connected'
                          : server.id === targetId
                            ? 'target'
                            : hop >= 0
                              ? `relay ${hop + 1}`
                              : sort === 'place'
                                ? `${server.city}, ${server.country}`
                                : sort === 'kind'
                                  ? KIND_LABELS[server.kind]
                                  : server.city}
                    </span>
                  </button>
                  {server.id !== gateway.id &&
                    (routeIds.includes(server.id) ? (
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
              {selected.id !== gateway.id && (() => {
                const scanned = game.scanned.includes(selected.id);
                const connected = game.connections.some((c) => c.serverId === selected.id);
                const scanning = game.tasks.some((task) => task.target.kind === 'scan' && task.target.serverId === selected.id);
                if (scanned || connected) {
                  const security = selected.security;
                  return (
                    <div class="map__scan">
                      <span class="map__scan-head">Security</span>
                      <span class="map__scan-grid data">
                        <span>Password {security.password || '—'}</span>
                        <span>Proxy {security.proxy || '—'}</span>
                        <span>Firewall {security.firewall || '—'}</span>
                        <span>Monitor {security.monitor || '—'}</span>
                      </span>
                    </div>
                  );
                }
                if (scanning) return <p class="map__scan-wait data">Scanning…</p>;
                if (ownedProgram(game, content, 'scan')) {
                  return (
                    <button
                      type="button"
                      class="btn btn--small map__scan-btn"
                      data-tip="Read this server's security from the outside, before you connect."
                      onClick={() => run({ type: 'scanServer', serverId: selected.id })}
                    >
                      Scan
                    </button>
                  );
                }
                return null;
              })()}
              {selected.id !== gateway.id && <RelayNote server={selected} cover={relayCover(game, selected)} {...relayMarks(selected)} target={target} />}
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
                  ) : inRoute && live ? (
                    <button
                      type="button"
                      class="btn"
                      disabled
                      data-tip="Take this server out of your route"
                    >
                      Remove from route
                    </button>
                  ) : (
                    <button
                      type="button"
                      class="btn"
                      disabled={!!live || connectedTo || inRoute}
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
                      data-tip={
                        inRoute
                          ? 'Connect to this server through the other relays in your route. It comes out of the route.'
                          : 'Connect to this server through the relays in your route'
                      }
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
                {index > 0 && index <= routeIds.length && stepFade(content, routeIds.length - index) < 1 && (
                  <span
                    class="route__fade data"
                    data-tip="A trace gathers pace. This relay is far enough from the target that its step counts for less. Put your best relays last, next to the target."
                  >
                    {Math.round(stepFade(content, routeIds.length - index) * 100)}%
                  </span>
                )}
                {!live && index > 0 && index <= routeIds.length && (
                  <button
                    type="button"
                    class="route__drop"
                    aria-label={`Remove ${server.name} from the route`}
                    data-tip="Take this relay out of the route"
                    onClick={() => run({ type: 'removeHop', serverId: server.id })}
                  >
                    ×
                  </button>
                )}
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
          {!live && (
            <span class="route__slots" role="group" aria-label="Saved routes">
              {Array.from({ length: ROUTE_SLOTS }, (_, slot) => {
                const saved = game.savedRoutes[slot] ?? [];
                const same = saved.length > 0 && saved.join() === game.route.join();
                return saved.length > 0 && (same || game.route.length === 0 || !saving) ? (
                  <button
                    key={slot}
                    type="button"
                    class={`route__slot is-kept${same ? ' is-on' : ''}`}
                    data-tip={`Load saved route ${slot + 1}: ${saved.map((id) => byId(id)?.name ?? id).join(', ')}`}
                    onClick={() => run({ type: 'loadRoute', slot })}
                  >
                    {slot + 1}
                  </button>
                ) : (
                  <button
                    key={slot}
                    type="button"
                    class={`route__slot${saving ? ' is-saving' : ''}`}
                    disabled={game.route.length === 0}
                    data-tip={saved.length > 0 ? `Replace saved route ${slot + 1} with this one` : `Keep this route in slot ${slot + 1}`}
                    onClick={() => {
                      run({ type: 'saveRoute', slot });
                      setSaving(false);
                    }}
                  >
                    {saved.length > 0 ? slot + 1 : '+'}
                  </button>
                );
              })}
              {game.route.length > 0 && game.savedRoutes.some((saved) => saved.length > 0) && (
                <button
                  type="button"
                  class={`route__slot route__slot--save${saving ? ' is-on' : ''}`}
                  aria-pressed={saving}
                  data-tip="Keep this route: press Save, then the slot to put it in"
                  onClick={() => setSaving((on) => !on)}
                >
                  Save
                </button>
              )}
            </span>
          )}
          {!live &&
            (planner ? (
              canFill && (
                <button
                  type="button"
                  class="btn btn--go"
                  data-tip={`${planner.name} v${planner.version} places up to ${PLANNER_HOPS[planner.version] ?? 0} relays. ${PLANNER_TIPS[planner.version] ?? ''} The server you have picked stays out of it, as your target.`}
                  onClick={() => run({ type: 'autoRoute', targetId: fillTarget })}
                >
                  Plan route
                </button>
              )
            ) : (
              <button type="button" class="btn" disabled data-tip="A Route Planner program fills the route in one press. The Backroom sells them.">
                Plan route
              </button>
            ))}
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
