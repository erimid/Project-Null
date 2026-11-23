import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { landBorders, landCoasts, landDots } from '../../content';
import { boxAround, placeLabels, type Box, type LabelAsk } from './labels';
import { blendView, dragView, greatCircle, isVisible, project, type LatLon, type View } from './projection';

export interface GlobeDot extends LatLon {
  readonly id: string;
  readonly name: string;
  /** mint = yours or on your route, cyan = known, red = danger, violet = taken by Chorus. */
  readonly tone: 'mint' | 'cyan' | 'red' | 'violet';
  /** Short text drawn next to the dot, e.g. "YOU" or "2". */
  readonly label?: string;
  readonly selected?: boolean;
  /** Just taken: rings spread out from it for a few seconds. */
  readonly ripple?: boolean;
  /**
   * Trouble the player has left here, drawn as a thin ring: a case open
   * (red, its arc running down to when the log is read), lines left in the
   * log (amber dashes) or an admin on the watch (amber dots).
   */
  readonly ring?: { readonly kind: 'case' | 'logs' | 'watch'; readonly left?: number; readonly urgent?: boolean };
  /** More words for the dot's tooltip, after its name. */
  readonly note?: string;
}

/** A small mark beside a place: work on the board there, news about it, or the job in hand. */
export interface GlobePin extends LatLon {
  /** The server it is about. */
  readonly id: string;
  readonly kind: 'job' | 'news' | 'mine';
  /** Tooltip text. */
  readonly note: string;
  /** Not looked at yet: a soft ring pulses out from it. */
  readonly fresh?: boolean;
}

export interface GlobeArc {
  readonly from: LatLon;
  readonly to: LatLon;
  readonly tone: 'mint' | 'cyan' | 'red' | 'violet';
  readonly dashed?: boolean;
  /** Chorus reaching from one server to the next: thin, and moving. */
  readonly reach?: boolean;
  /** Drawn heavier: a leg that hops to another part of the world. */
  readonly heavy?: boolean;
  /** Drawn lighter: a leg that stays inside one country. */
  readonly light?: boolean;
  /** Short text drawn beside the arc where there is room, e.g. "+14s". */
  readonly label?: string;
}

interface Props {
  dots: readonly GlobeDot[];
  arcs: readonly GlobeArc[];
  /** Turn the globe to face this place when it changes. */
  focus?: LatLon | null;
  onPick: (id: string) => void;
  /** Marks for jobs and news, drawn over the dots. Picking one picks its server. */
  pins?: readonly GlobePin[];
  /** Drawn in the globe's top corner, over it: the layer switches. */
  overlay?: ComponentChildren;
}

export const SIZE = 500;
export const C = SIZE / 2;
/** Radius of the globe at zoom 1, in drawing units. */
export const BASE_RADIUS = 200;
const ZOOMS = [1, 1.6, 2.5] as const;
const COLORS = { mint: '#4ee6c8', cyan: '#5fd4ff', red: '#ff3b4e', violet: '#c48bff' } as const;
const AMBER = '#ffc45c';
/** Radius of a trouble ring, and its length all the way round. */
const RING = 9;
const RING_LENGTH = 2 * Math.PI * RING;
const fmt = (n: number) => n.toFixed(1);

/** Lines of latitude and longitude, as lists of points. Built once. */
const GRID: LatLon[][] = (() => {
  const lines: LatLon[][] = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    const line: LatLon[] = [];
    for (let lon = -180; lon <= 180; lon += 4) line.push({ lat, lon });
    lines.push(line);
  }
  for (let lon = -180; lon < 180; lon += 15) {
    const line: LatLon[] = [];
    for (let lat = -90; lat <= 90; lat += 4) line.push({ lat, lon });
    lines.push(line);
  }
  return lines;
})();

export function gridPaths(view: View, R: number): { front: string; back: string } {
  let front = '';
  let back = '';
  for (const line of GRID) {
    let wasFront: boolean | null = null;
    for (const point of line) {
      const p = project(point.lat, point.lon, view);
      const isFront = p.z >= 0;
      const step = `${wasFront === isFront ? 'L' : 'M'}${fmt(C + R * p.x)} ${fmt(C - R * p.y)}`;
      if (isFront) front += step;
      else back += step;
      wasFront = isFront;
    }
  }
  return { front, back };
}

export function landPath(view: View, R: number): string {
  let d = '';
  for (let i = 0; i < landDots.length; i += 2) {
    const p = project(landDots[i]! / 10, landDots[i + 1]! / 10, view);
    if (p.z > 0.02) d += `M${fmt(C + R * p.x)} ${fmt(C - R * p.y)}h0`;
  }
  return d;
}

/** Lines over the land (coasts, or borders), as one path. Only the near side is drawn. */
function linePath(lines: readonly (readonly number[])[], view: View, R: number): string {
  let d = '';
  for (const line of lines) {
    let drawing = false;
    for (let i = 0; i < line.length; i += 2) {
      const p = project(line[i]! / 10, line[i + 1]! / 10, view);
      if (p.z > 0.01) {
        d += `${drawing ? 'L' : 'M'}${fmt(C + R * p.x)} ${fmt(C - R * p.y)}`;
        drawing = true;
      } else {
        drawing = false;
      }
    }
  }
  return d;
}

/** The outline of the land. */
export const coastPath = (view: View, R: number) => linePath(landCoasts, view, R);
/** The lines between countries. */
export const borderPath = (view: View, R: number) => linePath(landBorders, view, R);

/** An arc between two places, lifted off the surface in the middle. */
export function arcPath(arc: GlobeArc, view: View, R: number): string {
  let d = '';
  let drawing = false;
  for (const point of greatCircle(arc.from, arc.to, 40)) {
    const p = project(point.lat, point.lon, view, 1 + 0.12 * Math.sin(Math.PI * point.t));
    if (isVisible(p)) {
      d += `${drawing ? 'L' : 'M'}${fmt(C + R * p.x)} ${fmt(C - R * p.y)}`;
      drawing = true;
    } else {
      drawing = false;
    }
  }
  return d;
}

/** How far along an arc its label may sit, best first: the top of the arc, then a little to either side. */
const LABEL_STOPS = [10, 8, 12, 6, 14] as const;
const DOT_FONT = 12;
const LEG_FONT = 13;
/** Share Tech Mono is a little over half as wide as it is tall. */
const textWidth = (text: string, size: number) => text.length * size * 0.6 + 4;
/** The corner switches and the zoom buttons lie over the globe; words keep out from under them. */
const CORNERS: readonly Box[] = [
  { x: 0, y: 0, w: 230, h: 36 },
  { x: SIZE - 44, y: SIZE - 84, w: 44, h: 84 },
];
const BOUNDS: Box = { x: 3, y: 3, w: SIZE - 6, h: SIZE - 6 };

/** Places a dot's label could go: beside it, upper right first, then further out when the dots crowd together. */
function dotLabelSpots(x: number, y: number, w: number): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (const reach of [0, 9, 20]) {
    const side = 8 + reach + w / 2;
    const rise = 10 + reach * 0.7;
    spots.push({ x: x + side, y: y - rise }, { x: x + side, y: y + rise }, { x: x - side, y: y + rise }, { x: x - side, y: y - rise });
    spots.push({ x: x + side + 3, y }, { x: x - side - 3, y }, { x, y: y - rise - 6 }, { x, y: y + rise + 6 });
  }
  return spots;
}

/** Places an arc's label could go: just off the arc, on the side away from the globe's centre, else on the near side. */
function arcLabelSpots(arc: GlobeArc, w: number, view: View, R: number): { x: number; y: number }[] {
  const points = greatCircle(arc.from, arc.to, 20);
  const spots: { x: number; y: number }[] = [];
  for (const stop of LABEL_STOPS) {
    const point = points[stop];
    if (!point) continue;
    const p = project(point.lat, point.lon, view, 1 + 0.12 * Math.sin(Math.PI * point.t));
    if (!isVisible(p)) continue;
    const x = C + R * p.x;
    const y = C - R * p.y;
    // Straight out from the centre of the view, far enough that the words clear the line.
    const far = Math.hypot(p.x, p.y);
    const ux = far < 0.05 ? 0 : p.x / far;
    const uy = far < 0.05 ? -1 : -p.y / far;
    const clear = 7 + (w / 2) * Math.abs(ux) + (LEG_FONT / 2) * Math.abs(uy);
    spots.push({ x: x + ux * clear, y: y + uy * clear }, { x: x - ux * clear, y: y - uy * clear });
  }
  return spots;
}

/**
 * The wireframe Earth. Drag to turn it; click a dot to pick a server.
 * Everything is drawn from real latitudes and longitudes.
 */
export function Globe({ dots, arcs, focus, onPick, pins = [], overlay }: Props) {
  const [view, setView] = useState<View>({ lat: 28, lon: 8 });
  const [zoomStep, setZoomStep] = useState(0);
  const R = BASE_RADIUS * ZOOMS[zoomStep]!;
  const zoomBy = (change: number) => setZoomStep((step) => Math.min(ZOOMS.length - 1, Math.max(0, step + change)));
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Glide round to face a place picked from the list.
  const focusLat = focus?.lat;
  const focusLon = focus?.lon;
  useEffect(() => {
    if (focusLat === undefined || focusLon === undefined) return;
    // Don't tilt all the way: a view from over the pole is hard to read.
    const target = { lat: Math.min(35, Math.max(-35, focusLat)), lon: focusLon };
    let frame = 0;
    const step = () => {
      let done = false;
      setView((current) => {
        const next = blendView(current, target, 0.18);
        done = Math.abs(next.lat - target.lat) < 0.2 && Math.abs(next.lon - target.lon) < 0.2;
        return done ? target : next;
      });
      if (!done) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [focusLat, focusLon]);

  const grid = useMemo(() => gridPaths(view, R), [view, R]);
  const land = useMemo(() => landPath(view, R), [view, R]);
  const coast = useMemo(() => coastPath(view, R), [view, R]);
  const border = useMemo(() => borderPath(view, R), [view, R]);

  const pxPerUnit = () => (svg.current ? svg.current.clientWidth / SIZE : 1);

  // Two fingers pinch to zoom. Each finger is tracked by its pointer id.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const spread = () => {
    const [a, b] = [...fingers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.pointerType === 'touch') fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.current.size === 2) {
      // A second finger turns the drag into a pinch.
      drag.current = null;
      pinch.current = spread();
      svg.current?.setPointerCapture(event.pointerId);
      return;
    }
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current !== null && fingers.current.size === 2) {
      const now = spread();
      // The zoom has three steps, so a pinch moves one step each time the fingers spread or close by a quarter.
      if (now > pinch.current * 1.25) {
        zoomBy(1);
        pinch.current = now;
      } else if (now < pinch.current * 0.8) {
        zoomBy(-1);
        pinch.current = now;
      }
      return;
    }
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      active.moved = true;
      // Capture only once it is clearly a drag, so a plain click still reaches the dot under it.
      svg.current?.setPointerCapture(event.pointerId);
    }
    active.x = event.clientX;
    active.y = event.clientY;
    setView((current) => dragView(current, dx, dy, R * pxPerUnit()));
  };
  const onPointerUp = (event: PointerEvent) => {
    fingers.current.delete(event.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const placed = dots
    .map((dot) => ({ dot, p: project(dot.lat, dot.lon, view) }))
    .filter(({ p }) => p.z > 0.03)
    // Draw the selected dot last so it sits on top.
    .sort((a, b) => Number(a.dot.selected ?? false) - Number(b.dot.selected ?? false));
  const pinned = pins.map((pin) => ({ pin, p: project(pin.lat, pin.lon, view) })).filter(({ p }) => p.z > 0.03);

  // Words are given room in order: a dot's own label first, then the legs, longest wait first.
  // One with nowhere clear to go is left off; the route list under the globe has them all.
  const asks: LabelAsk[] = [];
  // Words first ("YOU", a server's name), then the hop numbers in order.
  const byLength = [...placed].sort((a, b) => (b.dot.label?.length ?? 0) - (a.dot.label?.length ?? 0));
  for (const { dot, p } of byLength) {
    if (!dot.label) continue;
    const x = C + R * p.x;
    const y = C - R * p.y;
    const w = textWidth(dot.label, DOT_FONT);
    asks.push({ id: `dot:${dot.id}`, w, h: DOT_FONT, spots: dotLabelSpots(x, y, w) });
  }
  arcs
    .map((arc, index) => ({ arc, index }))
    .filter(({ arc }) => arc.label)
    .sort((a, b) => Number(b.arc.heavy ?? false) - Number(a.arc.heavy ?? false) || Number(a.arc.light ?? false) - Number(b.arc.light ?? false))
    .forEach(({ arc, index }) => asks.push({ id: `arc:${index}`, w: textWidth(arc.label!, LEG_FONT), h: LEG_FONT, spots: arcLabelSpots(arc, textWidth(arc.label!, LEG_FONT), view, R) }));
  const labelAt = placeLabels(
    asks,
    [...CORNERS, ...placed.map(({ p }) => boxAround(C + R * p.x, C - R * p.y, 11)), ...pinned.map(({ p }) => boxAround(C + R * p.x - 9, C - R * p.y - 9, 9))],
    BOUNDS,
  );

  return (
    <div class="globe-frame">
      <svg
        ref={svg}
        class="globe"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label="Globe. Drag to turn it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event: WheelEvent) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1 : -1);
        }}
      >
        <defs>
          <radialGradient id="globe-atmosphere" cx="50%" cy="50%" r="50%">
            <stop offset="78%" stop-color="#5fd4ff" stop-opacity="0" />
            <stop offset="88%" stop-color="#5fd4ff" stop-opacity="0.16" />
            <stop offset="100%" stop-color="#5fd4ff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="globe-body" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stop-color="#0d2c46" />
            <stop offset="100%" stop-color="#040c16" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R * 1.18} fill="url(#globe-atmosphere)" />
        <path d={grid.back} fill="none" stroke="#5fd4ff" stroke-width="0.8" opacity="0.14" />
        <circle cx={C} cy={C} r={R} fill="url(#globe-body)" opacity="0.82" />
        <path d={land} stroke="#2f9ccc" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.5" />
        <path d={grid.front} fill="none" stroke="#5fd4ff" stroke-width="1" opacity="0.28" />
        <path d={border} fill="none" stroke="#5fd4ff" stroke-width="0.7" stroke-linejoin="round" opacity="0.3" />
        <path d={coast} fill="none" stroke="#7fe0ff" stroke-width="1.1" stroke-linejoin="round" opacity="0.85" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="#5fd4ff" stroke-width="1.6" opacity="0.9" />

        {arcs.map((arc, index) => (
          <path
            key={index}
            d={arcPath(arc, view, R)}
            fill="none"
            stroke={COLORS[arc.tone]}
            class={arc.reach ? 'globe__reach' : undefined}
            stroke-width={arc.reach ? 1.6 : (arc.dashed ? 2 : 2.6) + (arc.heavy ? 1.2 : arc.light ? -0.6 : 0)}
            stroke-dasharray={arc.dashed && !arc.reach ? '5 4' : undefined}
            stroke-linecap="round"
          />
        ))}
        {arcs.map((arc, index) => {
          const at = labelAt.get(`arc:${index}`);
          return (
            at && (
              <text key={`label-${index}`} x={fmt(at.x)} y={fmt(at.y)} text-anchor="middle" dominant-baseline="central" fill={COLORS[arc.tone]} font-size={LEG_FONT} class="globe__label globe__label--leg">
                {arc.label}
              </text>
            )
          );
        })}

        {placed.map(({ dot, p }) => {
          const x = C + R * p.x;
          const y = C - R * p.y;
          const color = COLORS[dot.tone];
          return (
            <g
              key={dot.id}
              class="globe__dot"
              role="button"
              tabIndex={0}
              aria-label={dot.name}
              aria-pressed={dot.selected ?? false}
              onClick={() => onPick(dot.id)}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPick(dot.id);
                }
              }}
            >
              <title>{dot.note ? `${dot.name}. ${dot.note}` : dot.name}</title>
              <circle cx={x} cy={y} r={14} fill="transparent" />
              {dot.ring && <TroubleRing x={x} y={y} ring={dot.ring} />}
              {dot.tone === 'violet' && <circle cx={x} cy={y} r={12} class="globe__halo" />}
              {dot.ripple && <circle cx={x} cy={y} r={12} class="globe__ripple" />}
              {dot.ripple && <circle cx={x} cy={y} r={12} class="globe__ripple globe__ripple--late" />}
              {dot.selected && <circle cx={x} cy={y} r={11} fill="none" stroke={color} stroke-width="1.5" />}
              <circle cx={x} cy={y} r={4.5} fill={color} />
              {dot.label && labelAt.has(`dot:${dot.id}`) && (
                <text x={fmt(labelAt.get(`dot:${dot.id}`)!.x)} y={fmt(labelAt.get(`dot:${dot.id}`)!.y)} text-anchor="middle" dominant-baseline="central" fill={color} font-size={DOT_FONT} class="globe__label globe__label--dot">
                  {dot.label}
                </text>
              )}
            </g>
          );
        })}

        {pinned.map(({ pin, p }) => {
          // Up and to the left of the dot, clear of its label on the right.
          const x = C + R * p.x - 9;
          const y = C - R * p.y - 9;
          const pick = () => onPick(pin.id);
          return (
            <g
              key={`pin-${pin.id}`}
              class={`globe__pin globe__pin--${pin.kind}`}
              role="button"
              tabIndex={0}
              aria-label={pin.note}
              onClick={pick}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  pick();
                }
              }}
            >
              <title>{pin.note}</title>
              <circle cx={x} cy={y} r={8} fill="transparent" />
              {pin.fresh && <circle cx={x} cy={y} r={6} class="globe__pulse" />}
              {pin.kind === 'news' ? (
                <rect x={x - 2.6} y={y - 2.6} width={5.2} height={5.2} rx={0.8} class="globe__pin-mark" />
              ) : (
                <path d={diamond(x, y, pin.kind === 'mine' ? 4.6 : 3.6)} class="globe__pin-mark" />
              )}
            </g>
          );
        })}
      </svg>
      {overlay && <div class="globe-layers">{overlay}</div>}
      <div class="globe-zoom">
        <button type="button" aria-label="Zoom in" disabled={zoomStep === ZOOMS.length - 1} onClick={() => zoomBy(1)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" disabled={zoomStep === 0} onClick={() => zoomBy(-1)}>
          −
        </button>
      </div>
    </div>
  );
}

const diamond = (x: number, y: number, r: number) => `M${fmt(x)} ${fmt(y - r)}L${fmt(x + r)} ${fmt(y)}L${fmt(x)} ${fmt(y + r)}L${fmt(x - r)} ${fmt(y)}Z`;

/** The thin ring round a server where the player has left trouble. */
function TroubleRing({ x, y, ring }: { x: number; y: number; ring: NonNullable<GlobeDot['ring']> }) {
  if (ring.kind === 'case') {
    // A faint full ring, and over it the time left before someone reads the log, running down clockwise from the top.
    const left = Math.max(0.04, Math.min(1, ring.left ?? 1));
    return (
      <g class={`globe__ring globe__ring--case${ring.urgent ? ' is-urgent' : ''}`}>
        <circle cx={x} cy={y} r={RING} fill="none" stroke={COLORS.red} stroke-width="1" opacity="0.28" />
        <circle
          cx={x}
          cy={y}
          r={RING}
          fill="none"
          stroke={COLORS.red}
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-dasharray={`${fmt(RING_LENGTH * left)} ${fmt(RING_LENGTH)}`}
          transform={`rotate(-90 ${fmt(x)} ${fmt(y)})`}
        />
      </g>
    );
  }
  return (
    <circle
      cx={x}
      cy={y}
      r={RING}
      fill="none"
      stroke={AMBER}
      class={`globe__ring globe__ring--${ring.kind}`}
      stroke-width={ring.kind === 'logs' ? 1.3 : 1.6}
      stroke-linecap="round"
      stroke-dasharray={ring.kind === 'logs' ? '3 2.6' : '0.1 3.4'}
      opacity={ring.kind === 'logs' ? 0.75 : 0.6}
    />
  );
}
