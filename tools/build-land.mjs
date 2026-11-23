// Builds src/content/land.json: what draws the continents on the globe.
//
// It samples the Natural Earth land outline (public domain, from the
// world-atlas package) on an even grid and keeps the points that fall on
// land (the dots), and it keeps the outline itself (the coasts) and the
// lines between countries (the borders). The result is committed, so the
// game itself needs neither package.
//
// Run with: npm run build:land
import { readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';

const STEP = 2.5; // degrees between rows of dots
const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-110m.json', import.meta.url), 'utf8'));
const land = feature(topo, topo.objects.land);
const polygons = land.features.flatMap((f) =>
  f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
);

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const isLand = (lon, lat) =>
  polygons.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lon, lat, hole)));

// Flat list [lat, lon, lat, lon, ...] in tenths of a degree, to keep the file small.
const points = [];
for (let lat = -87.5; lat <= 87.5; lat += STEP) {
  const count = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
  for (let i = 0; i < count; i++) {
    const lon = -180 + (360 * (i + 0.5)) / count;
    if (isLand(lon, lat)) points.push(Math.round(lat * 10), Math.round(lon * 10));
  }
}

// A line as [lat, lon, lat, lon, ...] in tenths of a degree, without points that land on the one before.
const flat = (line) => {
  const out = [];
  for (const [lon, lat] of line) {
    const a = Math.round(lat * 10);
    const b = Math.round(lon * 10);
    if (out.length >= 2 && out[out.length - 2] === a && out[out.length - 1] === b) continue;
    out.push(a, b);
  }
  return out;
};
const worthDrawing = (line) => line.length >= 6;

// Coasts: every outline of the land, lakes left out. Specks of islands are dropped.
const coasts = polygons.map((rings) => flat(rings[0])).filter((line) => line.length >= 10);

// Borders: only the lines two countries share, so no coast is drawn twice.
const world = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-110m.json', import.meta.url), 'utf8'));
const shared = mesh(world, world.objects.countries, (a, b) => a !== b);
const borders = shared.coordinates.map(flat).filter(worthDrawing);

writeFileSync(new URL('../src/content/land.json', import.meta.url), JSON.stringify({ step: STEP, points, coasts, borders }) + '\n');
const count = (lines) => lines.reduce((sum, line) => sum + line.length / 2, 0);
console.log(`land.json: ${points.length / 2} dots, ${coasts.length} coasts (${count(coasts)} points), ${borders.length} borders (${count(borders)} points)`);
