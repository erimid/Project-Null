/**
 * Sound. Everything is made by the browser's synthesiser as it plays:
 * there are no sound files. Nothing plays until the player has clicked
 * or pressed a key at least once (browsers insist on that).
 */
import { useEffect, useState } from 'preact/hooks';

export interface SoundSettings {
  readonly on: boolean;
  /** 0 to 1: everything. */
  readonly volume: number;
  /** The soundtrack, which can be turned off on its own. */
  readonly music: boolean;
  /** 0 to 1, under the main volume. */
  readonly musicVolume: number;
  /** 0 to 1, under the main volume: beeps, alarms, clicks. */
  readonly effectsVolume: number;
  /** 0 to 1, under the main volume: the room and the hum of the machine you are in. */
  readonly ambientVolume: number;
}

const STORAGE_KEY = 'project-null.sound.v1';
export const SOUND_DEFAULTS: SoundSettings = { on: true, volume: 0.6, music: true, musicVolume: 0.5, effectsVolume: 0.8, ambientVolume: 0.5 };
/** The effects slider's resting place: there, effects are as loud as they were before it existed. */
const EFFECTS_UNITY = 0.8;

const share = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback);

/** Reads saved settings, filling in whatever an older version of the game did not save. */
export function readSoundSettings(saved: unknown): SoundSettings {
  if (typeof saved !== 'object' || saved === null) return SOUND_DEFAULTS;
  const { on, volume, music, musicVolume, effectsVolume, ambientVolume } = saved as Record<string, unknown>;
  if (typeof on !== 'boolean' || typeof volume !== 'number' || volume < 0 || volume > 1) return SOUND_DEFAULTS;
  return {
    on,
    volume,
    // Settings saved before there was a soundtrack have it on.
    music: typeof music === 'boolean' ? music : true,
    musicVolume: share(musicVolume, SOUND_DEFAULTS.musicVolume),
    effectsVolume: share(effectsVolume, SOUND_DEFAULTS.effectsVolume),
    ambientVolume: share(ambientVolume, SOUND_DEFAULTS.ambientVolume),
  };
}

function load(): SoundSettings {
  try {
    return readSoundSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    // Unreadable or blocked storage: use the defaults.
    return SOUND_DEFAULTS;
  }
}

/** The three things the player can balance against each other. */
export type Bus = 'effects' | 'music' | 'ambient';

interface Desk {
  readonly master: GainNode;
  readonly buses: Record<Bus, GainNode>;
  /** The music passes through this on its way out, so a loud moment can push it down. */
  readonly duck: GainNode;
}

let settings = load();
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let desk: Desk | null = null;

const level = () => (settings.on ? settings.volume : 0);
const busLevel = (bus: Bus): number =>
  bus === 'effects' ? settings.effectsVolume / EFFECTS_UNITY : bus === 'ambient' ? settings.ambientVolume : 1;

/** How much of the effects goes to the room, and how long the room rings. */
const ROOM_SEND = 0.2;
const ROOM_SECONDS = 1.1;

/**
 * The sound of a small hard room, made from decaying hiss: a handful of
 * early slaps, then a tail that gets duller as it dies. Left and right
 * differ, which is what makes it sit around the head instead of in it.
 */
function roomImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * ROOM_SECONDS);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Duller with time: more of the last sample is kept as the tail goes on.
      const keep = 0.25 + 0.6 * t;
      smooth = smooth * keep + (Math.random() * 2 - 1) * (1 - keep);
      data[i] = smooth * (1 - t) ** 2.6;
    }
    for (const ms of channel === 0 ? [11, 23, 37] : [13, 29, 41]) {
      const at = Math.floor((ms / 1000) * ctx.sampleRate);
      if (at < length) data[at] = (data[at] ?? 0) + (channel === 0 ? 0.5 : -0.5) * (1 - ms / 60);
    }
  }
  return impulse;
}

function build(ctx: AudioContext): Desk {
  // Last in line: a limiter, so a pile-up of sounds gets firmer instead of crackling.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = level();
  master.connect(limiter);

  const gain = (bus: Bus): GainNode => {
    const node = ctx.createGain();
    node.gain.value = busLevel(bus);
    return node;
  };
  const buses: Record<Bus, GainNode> = { effects: gain('effects'), music: gain('music'), ambient: gain('ambient') };
  const duck = ctx.createGain();
  buses.music.connect(duck).connect(master);
  buses.ambient.connect(master);
  buses.effects.connect(master);

  // The room: effects are heard dry, and again, quieter, off the walls.
  try {
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    const send = ctx.createGain();
    send.gain.value = ROOM_SEND;
    buses.effects.connect(send).connect(room).connect(master);
  } catch {
    // No room on this browser: the effects play dry, as they used to.
  }
  return { master, buses, duck };
}

/** The synthesiser and the node a kind of sound plays into, or null where sound isn't available. */
export function output(bus: Bus = 'effects'): { ctx: AudioContext; out: AudioNode } | null {
  if (!context) {
    if (typeof AudioContext === 'undefined') return null;
    try {
      context = new AudioContext();
      desk = build(context);
    } catch {
      context = null;
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return { ctx: context, out: desk!.buses[bus] };
}

/**
 * Pushes the music down for a moment, so an alarm or a fanfare is heard
 * over it. `depth` is how much of the music is left (0.4 = 40%).
 */
export function duckMusic(depth: number, seconds: number): void {
  if (!context || !desk) return;
  const now = context.currentTime;
  const gain = desk.duck.gain;
  gain.cancelScheduledValues(now);
  gain.setTargetAtTime(Math.max(0, Math.min(1, depth)), now, 0.03);
  gain.setTargetAtTime(1, now + seconds, 0.35);
}

export const sound = {
  get: (): SoundSettings => settings,
  set(patch: Partial<SoundSettings>): void {
    settings = { ...settings, ...patch };
    if (context && desk) {
      desk.master.gain.setTargetAtTime(level(), context.currentTime, 0.02);
      for (const bus of ['effects', 'music', 'ambient'] as const) desk.buses[bus].gain.setTargetAtTime(busLevel(bus), context.currentTime, 0.02);
    }
    listeners.forEach((listener) => listener());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or blocked: the setting just won't be remembered.
    }
  },
};

/** Calls back whenever the sound settings change. */
export function onSoundChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** True once the browser has let the synthesiser start (after the player's first click or key). */
export const soundAwake = (): boolean => context?.state === 'running';

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

/**
 * Phones keep sound off until the player touches the page, and only let
 * it start inside that touch. So the first tap (or key) wakes the
 * synthesiser and plays a moment of silence, which is what iOS needs to
 * let later sounds through. After that this stops listening.
 */
function unlock(): void {
  const audio = output();
  if (!audio) return;
  const silence = audio.ctx.createBuffer(1, 1, audio.ctx.sampleRate);
  const source = audio.ctx.createBufferSource();
  source.buffer = silence;
  source.connect(audio.ctx.destination);
  source.start();
  void audio.ctx.resume().then(() => {
    if (audio.ctx.state !== 'running') return;
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, true);
  }, () => undefined);
}
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;
if (typeof window !== 'undefined') for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, true);
