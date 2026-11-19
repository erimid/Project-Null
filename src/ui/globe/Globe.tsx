import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { landDots } from '../../content';
import { blendView, dragView, greatCircle, isVisible, project, type LatLon, type View } from './projection';

export interface GlobeDot extends LatLon {
  readonly id: string;
  readonly name: string;
  /** mint = yours or on your route, cyan = known, red = danger. */
  readonly tone: 'mint' | 'cyan' | 'red';
  /** Short text drawn next to the dot, e.g. "YOU" or "2". */
  readonly label?: string;
  readonly selected?: boolean;
}

export interface GlobeArc {
  readonly from: LatLon;
  readonly to: LatLon;
  readonly tone: 'mint' | 'cyan' | 'red';
  readonly dashed?: boolean;
  /** Drawn heavier: a leg that hops to another part of the world. */
  readonly heavy?: boolean;
  /** Short text drawn at the top of the arc, e.g. "BORDER +14s". */
  readonly label?: string;
}

interface Props {
  dots: readonly GlobeDot[];
  arcs: readonly GlobeArc[];
  /** Turn the globe to face this place when it changes. */
  focus?: LatLon | null;
  onPick: (id: string) => void;
}

const SIZE = 500;
const C = SIZE / 2;
/** Radius of the globe at zoom 1, in drawing units. */
const BASE_RADIUS = 200;
const ZOOMS = [1, 1.6, 2.5] as const;
const COLORS = { mint: '#4ee6c8', cyan: '#5fd4ff', red: '#ff3b4e' } as const;
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

function gridPaths(view: View, R: number): { front: string; back: string } {
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

function landPath(view: View, R: number): string {
  let d = '';
  for (let i = 0; i < landDots.length; i += 2) {
    const p = project(landDots[i]! / 10, landDots[i + 1]! / 10, view);
    if (p.z > 0.02) d += `M${fmt(C + R * p.x)} ${fmt(C - R * p.y)}h0`;
  }
  return d;
}

/** An arc between two places, lifted off the surface in the middle. */
function arcPath(arc: GlobeArc, view: View, R: number): string {
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

/** Where to write an arc's label: just above its highest point, if that is on the near side. */
function arcLabelAt(arc: GlobeArc, view: View, R: number): { x: number; y: number } | null {
  const points = greatCircle(arc.from, arc.to, 2);
  const mid = points[1];
  if (!mid) return null;
  const p = project(mid.lat, mid.lon, view, 1.16);
  if (!isVisible(p)) return null;
  return { x: C + R * p.x, y: C - R * p.y - 6 };
}

/**
 * The wireframe Earth. Drag to turn it; click a dot to pick a server.
 * Everything is drawn from real latitudes and longitudes.
 */
export function Globe({ dots, arcs, focus, onPick }: Props) {
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
        <path d={land} stroke="#2f9ccc" stroke-width="2.6" stroke-linecap="round" fill="none" opacity="0.85" />
        <path d={grid.front} fill="none" stroke="#5fd4ff" stroke-width="1" opacity="0.4" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="#5fd4ff" stroke-width="1.6" opacity="0.9" />

        {arcs.map((arc, index) => (
          <path
            key={index}
            d={arcPath(arc, view, R)}
            fill="none"
            stroke={COLORS[arc.tone]}
            stroke-width={(arc.dashed ? 2 : 2.6) + (arc.heavy ? 1.2 : 0)}
            stroke-dasharray={arc.dashed ? '5 4' : undefined}
            stroke-linecap="round"
          />
        ))}
        {arcs.map((arc, index) => {
          const at = arc.label ? arcLabelAt(arc, view, R) : null;
          return (
            at && (
              <text key={`label-${index}`} x={at.x} y={at.y} text-anchor="middle" fill={COLORS[arc.tone]} font-size="13" class="globe__label globe__label--leg">
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
              <title>{dot.name}</title>
              <circle cx={x} cy={y} r={14} fill="transparent" />
              {dot.selected && <circle cx={x} cy={y} r={11} fill="none" stroke={color} stroke-width="1.5" />}
              <circle cx={x} cy={y} r={4.5} fill={color} />
              {dot.label && (
                <text x={x + 9} y={y - 8} fill={color} font-size="12" class="globe__label">
                  {dot.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
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
