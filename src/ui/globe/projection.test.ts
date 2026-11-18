import { describe, expect, it } from 'vitest';
import { angularDistance, blendView, dragView, greatCircle, isVisible, project, wrapLon } from './projection';

const view = { lat: 0, lon: 0 };
const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

describe('project', () => {
  it('puts the centre of the view in the middle, facing the viewer', () => {
    const p = project(20, 30, { lat: 20, lon: 30 });
    close(p.x, 0);
    close(p.y, 0);
    close(p.z, 1);
  });

  it('puts east to the right and north up', () => {
    close(project(0, 90, view).x, 1);
    close(project(0, -90, view).x, -1);
    close(project(90, 0, view).y, 1);
    close(project(-90, 0, view).y, -1);
  });

  it('puts the far side of the Earth behind', () => {
    expect(project(0, 180, view).z).toBeLessThan(0);
    expect(isVisible(project(0, 180, view))).toBe(false);
    expect(isVisible(project(0, 45, view))).toBe(true);
  });

  it('keeps every surface point on the unit sphere', () => {
    for (const [lat, lon] of [[10, 20], [-70, 150], [45, -120], [89, 3]] as const) {
      const p = project(lat, lon, { lat: 33, lon: -47 });
      close(Math.hypot(p.x, p.y, p.z), 1);
    }
  });

  it('lifts points off the surface with altitude', () => {
    const p = project(0, 90, view, 1.2);
    close(p.x, 1.2);
    // Just past the edge, but high enough to be seen over it.
    expect(isVisible(project(0, 95, view, 1.2))).toBe(true);
    expect(isVisible(project(0, 95, view, 1))).toBe(false);
  });

  it('tilts with the view latitude: looking from above the north pole', () => {
    const p = project(90, 0, { lat: 90, lon: 0 });
    close(p.z, 1);
  });
});

describe('distances and paths', () => {
  it('measures angles between places', () => {
    close(angularDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }), 90);
    close(angularDistance({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }), 180);
    close(angularDistance({ lat: 12, lon: 34 }, { lat: 12, lon: 34 }), 0);
    // Rotterdam to Oslo is roughly 8.3 degrees of arc (about 920 km).
    expect(angularDistance({ lat: 51.92, lon: 4.48 }, { lat: 59.91, lon: 10.75 })).toBeCloseTo(8.7, 0);
  });

  it('draws a path that starts and ends at the two places', () => {
    const a = { lat: 51.92, lon: 4.48 };
    const b = { lat: -23.55, lon: -46.63 };
    const path = greatCircle(a, b, 20);
    expect(path).toHaveLength(21);
    close(path[0]!.lat, a.lat);
    close(path[0]!.lon, a.lon);
    close(path[20]!.lat, b.lat);
    close(path[20]!.lon, b.lon);
    expect(path[10]!.t).toBe(0.5);
  });

  it('takes the short way: equal steps along the equator', () => {
    const path = greatCircle({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 4);
    expect(path.map((p) => Math.round(wrapLon(p.lon)))).toEqual([170, 175, -180, -175, -170]);
    for (const p of path) close(p.lat, 0);
  });

  it('copes with two identical places', () => {
    const path = greatCircle({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }, 3);
    for (const p of path) {
      close(p.lat, 10);
      close(p.lon, 10);
    }
  });
});

describe('turning the globe', () => {
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(540)).toBe(-180);
    expect(wrapLon(45)).toBe(45);
  });

  it('follows the pointer: dragging right brings the west into view', () => {
    const after = dragView(view, 100, 0, 200);
    expect(after.lon).toBeLessThan(0);
    // The point that was at the centre has moved right by about the drag distance.
    expect(project(0, 0, after).x * 200).toBeCloseTo(100, -1);
  });

  it('dragging down tilts the north towards the viewer, and stops short of the poles', () => {
    expect(dragView(view, 0, 50, 200).lat).toBeGreaterThan(0);
    expect(dragView(view, 0, 100_000, 200).lat).toBe(80);
    expect(dragView(view, 0, -100_000, 200).lat).toBe(-80);
  });

  it('blends between views the short way round', () => {
    const half = blendView({ lat: 0, lon: 170 }, { lat: 20, lon: -170 }, 0.5);
    close(half.lat, 10);
    expect(Math.abs(half.lon)).toBe(180);
    expect(blendView({ lat: 0, lon: 0 }, { lat: 40, lon: 90 }, 1)).toEqual({ lat: 40, lon: 90 });
  });
});
