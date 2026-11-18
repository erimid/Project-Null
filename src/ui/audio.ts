/**
 * Sound. Everything is made by the browser's synthesiser as it plays:
 * there are no sound files. Nothing plays until the player has clicked
 * or pressed a key at least once (browsers insist on that).
 */
import { useEffect, useState } from 'preact/hooks';

export interface SoundSettings {
  readonly on: boolean;
  /** 0 to 1. */
  readonly volume: number;
}

const STORAGE_KEY = 'project-null.sound.v1';

function load(): SoundSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof saved === 'object' && saved !== null) {
      const { on, volume } = saved as { on?: unknown; volume?: unknown };
      if (typeof on === 'boolean' && typeof volume === 'number' && volume >= 0 && volume <= 1) return { on, volume };
    }
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return { on: true, volume: 0.6 };
}

let settings = load();
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let master: GainNode | null = null;

const level = () => (settings.on ? settings.volume : 0);

/** The synthesiser and the node everything plays into, or null where sound isn't available. */
export function output(): { ctx: AudioContext; out: AudioNode } | null {
  if (!context) {
    if (typeof AudioContext === 'undefined') return null;
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = level();
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return { ctx: context, out: master! };
}

export const sound = {
  get: (): SoundSettings => settings,
  set(patch: Partial<SoundSettings>): void {
    settings = { ...settings, ...patch };
    if (context && master) master.gain.setTargetAtTime(level(), context.currentTime, 0.02);
    listeners.forEach((listener) => listener());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or blocked: the setting just won't be remembered.
    }
  },
};

export function useSound(): SoundSettings {
  const [value, setValue] = useState(settings);
  useEffect(() => {
    const update = () => setValue(settings);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}

/** A repeatable stream of numbers from 0 to 1, so the same text always sounds the same. */
export function seeded(text: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A second of hiss, shared by everything that wants noise. */
let noise: AudioBuffer | null = null;
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}
