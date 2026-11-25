/**
 * The moment a trace gets home. For three seconds the whole screen is
 * the globe: the route collapses hop by hop from the target back to the
 * gateway, then the line reads CONNECTION TERMINATED BY REMOTE HOST.
 * After that the desk comes back with the letter about it open.
 *
 * It is a picture of something that has already happened: the game has
 * moved on underneath, and a click or a key puts it away early.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { findServer, gatewayOf } from '../../core/content';
import { BASE_RADIUS, C, SIZE, arcPath, coastPath, gridPaths, landPath } from '../globe/Globe';
import { greatCircle, isVisible, project, wrapLon, type LatLon, type View } from '../globe/projection';
import { hushMusic } from '../music';
import { content, session } from '../session';
import { caughtFall, caughtHit } from '../sfx';
import { windows } from './windowStore';
import './caught.css';
import { reducedMotion } from './calm';

/** How long the route takes to collapse, the words stay up, and the screen takes to clear. */
const COLLAPSE_MS = 1800;
const WORDS_MS = 1200;
const FADE_MS = 350;

interface Scene {
  readonly server: string;
  /** The places the connection ran through, from the target back to the gateway. */
  readonly points: readonly (LatLon & { name: string })[];
}


/** A view of the globe facing a place, without tipping over the pole. */
const facing = (place: LatLon): View => ({ lat: Math.max(-35, Math.min(35, place.lat)), lon: place.lon });

/** The view part of the way from facing one place to facing another, turning the short way round. */
function between(a: LatLon, b: LatLon, t: number): View {
  const from = facing(a);
  const to = facing(b);
  return { lat: from.lat + (to.lat - from.lat) * t, lon: wrapLon(from.lon + wrapLon(to.lon - from.lon) * t) };
}

export function CaughtMoment() {
  const [scene, setScene] = useState<Scene | null>(null);
  /** 0 to 1 while the route collapses; 1 once the words are up. */
  const [fall, setFall] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // Routes of the connections that are open, kept so they are still known in the instant after one is cut.
  const routes = useRef(new Map<string, { serverId: string; route: string[] }>());

  useEffect(() => {
    const note = () => {
      for (const connection of session.getState().connections) routes.current.set(connection.id, { serverId: connection.serverId, route: [...connection.route] });
    };
    note();
    const stopGame = session.subscribeGame(note);
    const stopEvents = session.subscribeEvents((event) => {
      if (event.type !== 'disconnected' || !event.traced) return;
      const open = new Set(session.getState().connections.map((connection) => connection.id));
      const cut = [...routes.current].find(([id, entry]) => !open.has(id) && findServer(content, entry.serverId)?.name === event.server)?.[1];
      for (const id of routes.current.keys()) if (!open.has(id)) routes.current.delete(id);
      const target = cut && findServer(content, cut.serverId);
      const home = gatewayOf(content);
      const hops = (cut?.route ?? []).map((id) => findServer(content, id)).filter((server) => server !== undefined);
      const points = [...(target ? [target] : []), ...hops.reverse(), home].map((server) => ({ lat: server.lat, lon: server.lon, name: server.name }));
      setFall(0);
      setLeaving(false);
      setScene({ server: event.server, points });
    });
    return () => {
      stopGame();
      stopEvents();
    };
  }, []);

  // Runs the three seconds: the collapse frame by frame, the words, then the way out.
  useEffect(() => {
    if (!scene) return;
    const legs = Math.max(1, scene.points.length - 1);
    const still = reducedMotion();
    const collapse = still ? 0 : COLLAPSE_MS;
    hushMusic(collapse + WORDS_MS + FADE_MS + 400);
    const started = performance.now();
    let frame = 0;
    let lastLeg = -1;
    let hit = false;
    const tick = () => {
      const elapsed = performance.now() - started;
      const share = collapse === 0 ? 1 : Math.min(1, elapsed / collapse);
      const leg = Math.min(legs - 1, Math.floor(share * legs));
      if (share < 1 && leg !== lastLeg) {
        lastLeg = leg;
        caughtFall(leg, legs);
      }
      if (share >= 1 && !hit) {
        hit = true;
        caughtHit();
      }
      setFall(share);
      if (share < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const leave = () => setLeaving(true);
    const out = setTimeout(leave, collapse + WORDS_MS);
    const keys = (event: KeyboardEvent) => {
      event.stopPropagation();
      leave();
    };
    window.addEventListener('keydown', keys, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(out);
      window.removeEventListener('keydown', keys, true);
    };
  }, [scene]);

  useEffect(() => {
    if (!leaving) return;
    const done = setTimeout(() => {
      setScene(null);
      setLeaving(false);
      // Then the letter.
      windows.focus('messages');
    }, FADE_MS);
    return () => clearTimeout(done);
  }, [leaving]);

  if (!scene) return null;

  const { points } = scene;
  const legs = Math.max(1, points.length - 1);
  const at = fall * legs;
  const leg = Math.min(legs - 1, Math.floor(at));
  const within = fall >= 1 ? 1 : at - leg;
  const from = points[leg] ?? points[0]!;
  const to = points[leg + 1] ?? from;
  // The globe turns to follow the trace home.
  const view = between(from, to, within);
  const R = BASE_RADIUS;
  const grid = gridPaths(view, R);
  const head = greatCircle(from, to, 20)[Math.round(within * 20)] ?? to;
  const headAt = project(head.lat, head.lon, view, 1 + 0.12 * Math.sin(Math.PI * within));
  const done = fall >= 1;

  return (
    <div class={`caught${done ? ' is-done' : ''}${leaving ? ' is-leaving' : ''}`} role="alert" aria-live="assertive" onClick={() => setLeaving(true)}>
      <div class="caught__static" aria-hidden="true" />
      <svg class="caught__globe" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={C} cy={C} r={R} class="caught__disc" />
        <path d={grid.back} class="caught__grid caught__grid--back" />
        <path d={grid.front} class="caught__grid" />
        <path d={landPath(view, R)} class="caught__land" />
        <path d={coastPath(view, R)} class="caught__coast" />
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1]!;
          const d = arcPath({ from: point, to: next, tone: 'red' }, view, R);
          // Behind the trace the route is gone; ahead of it the route still stands.
          const state = index < leg || done ? 'gone' : index === leg ? 'burning' : 'standing';
          return <path key={index} d={d} class={`caught__arc is-${state}`} />;
        })}
        {points.map((point, index) => {
          const p = project(point.lat, point.lon, view);
          if (!isVisible(p)) return null;
          const reached = index <= leg || done;
          const home = index === points.length - 1;
          return <circle key={index} cx={C + R * p.x} cy={C - R * p.y} r={home ? 5 : 3.5} class={`caught__dot${reached ? ' is-reached' : ''}${home ? ' is-home' : ''}${home && done ? ' is-hit' : ''}`} />;
        })}
        {!done && isVisible(headAt) && <circle cx={C + R * headAt.x} cy={C - R * headAt.y} r={6} class="caught__head" />}
      </svg>
      <p class="caught__trail data" aria-hidden="true">
        {done ? 'TRACE COMPLETE' : `TRACING ${String(Math.min(legs, leg + 1)).padStart(2, '0')}/${String(legs).padStart(2, '0')} · ${to.name.toUpperCase()}`}
      </p>
      <div class="caught__words">
        <strong class="data">CONNECTION TERMINATED BY REMOTE HOST</strong>
        <span>{scene.server} traced the connection to your gateway.</span>
      </div>
    </div>
  );
}
