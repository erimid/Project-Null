// Builds src/content/land.json: the dots that draw the continents on the globe.
//
// It samples the Natural Earth land outline (public domain, from the
// world-atlas package) on an even grid and keeps the points that fall on
// land. The result is committed, so the game itself needs neither package.
//
// Run with: npm run build:land
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

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

writeFileSync(new URL('../src/content/land.json', import.meta.url), JSON.stringify({ step: STEP, points }) + '\n');
console.log(`land.json: ${points.length / 2} dots`);
