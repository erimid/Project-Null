import { describe, expect, it } from 'vitest';
import type { ServerDef } from '../content/schema';
import { legKind, traceHopMs, traceLegs } from './index';
import { content as testContent, testRules, testServers } from './testWorld';
import type { Content } from './world';

/** The test world with servers spread over the map and the real-ish leg factors. */
const place = (id: string, country: string, lat: number, lon: number) => {
  const server = testServers.find((s) => s.id === id)!;
  return { ...server, country, lat, lon } as ServerDef;
};
const world: Content = {
  ...testContent,
  servers: testContent.servers.map((server) => {
    if (server.id === 'gateway') return place('gateway', 'Netherlands', 52, 4.5);
    if (server.id === 'relay-a') return place('relay-a', 'Netherlands', 52.4, 4.9);
    if (server.id === 'relay-b') return place('relay-b', 'Brazil', -23.5, -46.6);
    if (server.id === 'directory') return place('directory', 'Norway', 59.9, 10.7);
    return place(server.id, 'United Kingdom', 51.5, -0.1);
  }),
  rules: { ...testRules, sameCountryLegFactor: 0.8, borderLegFactor: 1, overseasLegFactor: 1.5 },
};
const target = world.servers.find((s) => s.id === 'corp')!;
const at = (id: string) => world.servers.find((s) => s.id === id)!;

describe('route geography', () => {
  it('sorts legs into one country, a border, or overseas', () => {
    expect(legKind(at('gateway'), at('relay-a'))).toBe('country');
    expect(legKind(at('gateway'), at('directory'))).toBe('border');
    expect(legKind(at('gateway'), at('relay-b'))).toBe('overseas');
  });

  it('stretches each relay step by the leg back towards you', () => {
    // corp: 10 s per hop. relay-a has delay 2 and sits in your own country; relay-b is overseas from relay-a.
    const ms = traceHopMs(world, target, ['relay-a', 'relay-b']);
    // Last relay first: relay-b (overseas from relay-a), then relay-a (same country as the gateway).
    expect(ms).toEqual([10_000 * 1 * 1.5, 10_000 * 2 * 0.8]);
  });

  it('applies the leg to a direct connection too', () => {
    expect(traceHopMs(world, target, [])).toEqual([10_000 * 0.5 * 1]);
  });

  it('lists every leg with what it costs the trace, the leg into the target free', () => {
    const legs = traceLegs(world, 'gateway', target, ['relay-a', 'relay-b']);
    expect(legs.map((leg) => [leg.fromId, leg.toId, leg.kind, leg.ms])).toEqual([
      ['gateway', 'relay-a', 'country', 16_000],
      ['relay-a', 'relay-b', 'overseas', 15_000],
      ['relay-b', 'corp', 'overseas', 0],
    ]);
    const direct = traceLegs(world, 'gateway', target, []);
    expect(direct).toEqual([{ fromId: 'gateway', toId: 'corp', kind: 'border', ms: 5_000 }]);
  });

  it('a route that hops continents outlasts one that stays at home', () => {
    expect(traceHopMs(world, target, ['relay-b'])[0]).toBeGreaterThan(traceHopMs(world, target, ['directory'])[0]!);
  });
});
