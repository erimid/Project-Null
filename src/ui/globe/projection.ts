/**
 * Maths for drawing the Earth as a globe (orthographic projection: the
 * view from far away, as in the mockup). Pure functions, no drawing.
 */

const RAD = Math.PI / 180;

/** Where the globe is turned: the latitude and longitude at the centre of the view. */
export interface View {
  readonly lat: number;
  readonly lon: number;
}

export interface Projected {
  /** Across the screen, -1 (left edge of the globe) to 1 (right edge). */
  readonly x: number;
  /** Up the screen, -1 (bottom) to 1 (top). */
  readonly y: number;
  /** Towards the viewer: above 0 is the near side, below 0 the far side. */
  readonly z: number;
}

/** Projects a point on the globe. `altitude` 1 is the surface; above 1 floats off it. */
export function project(lat: number, lon: number, view: View, altitude = 1): Projected {
  const phi = lat * RAD;
  const phi0 = view.lat * RAD;
  const lambda = (lon - view.lon) * RAD;
  const cosPhi = Math.cos(phi);
  return {
    x: altitude * cosPhi * Math.sin(lambda),
    y: altitude * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cosPhi * Math.cos(lambda)),
    z: altitude * (Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cosPhi * Math.cos(lambda)),
  };
}

/** True if a projected point can be seen (near side, or floating high enough to peek over the edge). */
export function isVisible(point: Projected): boolean {
  if (point.z >= 0) return true;
  return Math.hypot(point.x, point.y) > 1;
}

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Angle between two places as seen from the Earth's centre, in degrees (0 to 180). */
export function angularDistance(a: LatLon, b: LatLon): number {
  const cos =
    Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / RAD;
}

/**
 * Points along the shortest path over the globe from a to b ("great
 * circle"). `t` runs from 0 at a to 1 at b.
 */
export function greatCircle(a: LatLon, b: LatLon, steps: number): (LatLon & { t: number })[] {
  const toVector = (p: LatLon) => {
    const phi = p.lat * RAD;
    const lambda = p.lon * RAD;
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)] as const;
  };
  const va = toVector(a);
  const vb = toVector(b);
  const omega = angularDistance(a, b) * RAD;
  const points: (LatLon & { t: number })[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Nearly identical points (or exact opposites) have no single path; fall back to a straight blend.
    const sin = Math.sin(omega);
    const wa = sin < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / sin;
    const wb = sin < 1e-9 ? t : Math.sin(t * omega) / sin;
    const x = va[0] * wa + vb[0] * wb;
    const y = va[1] * wa + vb[1] * wb;
    const z = va[2] * wa + vb[2] * wb;
    const length = Math.hypot(x, y, z) || 1;
    points.push({ lat: Math.asin(z / length) / RAD, lon: Math.atan2(y, x) / RAD, t });
  }
  return points;
}

/** Keeps a longitude inside -180..180. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The view after dragging the globe by some pixels. `radius` is the globe's radius in pixels. */
export function dragView(view: View, dxPx: number, dyPx: number, radius: number): View {
  const degreesPerPx = 180 / (Math.PI * radius);
  return {
    lon: wrapLon(view.lon - dxPx * degreesPerPx),
    lat: Math.min(80, Math.max(-80, view.lat + dyPx * degreesPerPx)),
  };
}

/** A step from one view towards another, taking the short way round. `amount` 0..1. */
export function blendView(from: View, to: View, amount: number): View {
  const turn = wrapLon(to.lon - from.lon);
  return { lat: from.lat + (to.lat - from.lat) * amount, lon: wrapLon(from.lon + turn * amount) };
}
