import { useEffect, useMemo, useState } from 'preact/hooks';
import { BASE_RADIUS, C, SIZE, coastPath, gridPaths, landPath } from '../globe/Globe';
import { project, type View } from '../globe/projection';
import { reducedMotion } from '../desktop/calm';
import { content } from '../session';

/** Degrees the globe turns each second. */
const TURN = 2.4;
const STEP_MS = 80;

/** The globe from the route map, turning slowly by itself behind the title. Nothing on it can be pressed. */
export function TitleGlobe() {
  const [lon, setLon] = useState(8);
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = setInterval(() => setLon((now) => (now + (TURN * STEP_MS) / 1000) % 360), STEP_MS);
    return () => clearInterval(timer);
  }, []);
  const view: View = { lat: 22, lon: lon > 180 ? lon - 360 : lon };
  const R = BASE_RADIUS;
  const grid = useMemo(() => gridPaths(view, R), [lon]);
  const land = useMemo(() => landPath(view, R), [lon]);
  const coast = useMemo(() => coastPath(view, R), [lon]);
  // The fixed places of the world, as unnamed lights.
  const lights = content.servers
    .map((server) => project(server.lat, server.lon, view))
    .filter((p) => p.z > 0.05);
  return (
    <svg class="title__globe" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <defs>
        <radialGradient id="title-atmosphere" cx="50%" cy="50%" r="50%">
          <stop offset="78%" stop-color="var(--cyan)" stop-opacity="0" />
          <stop offset="88%" stop-color="var(--cyan)" stop-opacity="0.16" />
          <stop offset="100%" stop-color="var(--cyan)" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="title-body" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stop-color="var(--panel-hi2)" />
          <stop offset="100%" stop-color="var(--bg)" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={R * 1.18} fill="url(#title-atmosphere)" />
      <path d={grid.back} fill="none" stroke="var(--cyan)" stroke-width="0.8" opacity="0.14" />
      <circle cx={C} cy={C} r={R} fill="url(#title-body)" opacity="0.82" />
      <path d={land} stroke="var(--cyan-low)" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.5" />
      <path d={grid.front} fill="none" stroke="var(--cyan)" stroke-width="1" opacity="0.28" />
      <path d={coast} fill="none" stroke="var(--cyan-hi)" stroke-width="1.1" stroke-linejoin="round" opacity="0.85" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--cyan)" stroke-width="1.6" opacity="0.9" />
      {lights.map((p, index) => (
        <circle key={index} cx={C + R * p.x} cy={C - R * p.y} r="2.2" fill="var(--mint)" opacity={0.35 + 0.6 * p.z} />
      ))}
    </svg>
  );
}
