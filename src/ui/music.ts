/**
 * The soundtrack. A slow bed of held notes while the desk is quiet, a
 * soft pulse while connected, and a run that climbs with the countdown
 * under a trace. Like every other sound in the game it is made by the
 * browser's synthesiser as it plays: no files, no requests.
 *
 * score.ts says what to play; this file only plays it. A timer looks a
 * little way ahead and schedules each step on the synthesiser's own
 * clock, so the beat stays steady when the page is busy.
 */
import { mostUrgentTrace, traceHeld, traceReport } from '../core';
import { noiseBuffer, onSoundChange, output, sound, soundAwake } from './audio';
import { CHORDS, REST, chordAt, notesAt, runBrightness, stepSeconds, tempoFor, type Note, type Scene } from './score';
import { content, session } from './session';

/** The music sits well under the effects. */
const MUSIC_LEVEL = 0.5;
/** How far ahead notes are scheduled, and how often the timer looks. */
const AHEAD_SECONDS = 0.2;
const LOOK_MS = 60;

interface Rig {
  readonly ctx: AudioContext;
  /** Everything musical plays into this; it carries the music volume. */
  readonly bus: GainNode;
  /** Bells and the run go through an echo as well. */
  readonly echo: GainNode;
  readonly bed: { readonly oscillators: OscillatorNode[]; readonly gain: GainNode; readonly filter: BiquadFilterNode };
  readonly runFilter: BiquadFilterNode;
}

let rig: Rig | null = null;
let scene: Scene = REST;
let step = 0;
let nextAt = 0;
let chordNow: readonly number[] | null = null;
/** Set by the "caught" moment: the music holds its breath until this time (on the page's clock). */
let hushedUntil = 0;

const musicLevel = (): number => (sound.get().music && !document.hidden ? sound.get().musicVolume * MUSIC_LEVEL : 0);

/** What the game is doing right now, as the music hears it. */
function readScene(): Scene {
  const state = session.getState();
  const traced = mostUrgentTrace(state, content);
  if (traced) return { mood: 'trace', progress: traceReport(traced.trace).progress, held: traceHeld(state, content, traced) };
  return state.connections.length > 0 ? { mood: 'connected', progress: 0, held: false } : REST;
}

function build(): Rig | null {
  const sink = output();
  if (!sink) return null;
  const { ctx, out } = sink;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);

  // An echo, for room: each repeat quieter and duller than the last.
  const echo = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2200;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  echo.connect(delay);
  delay.connect(damp).connect(feedback).connect(delay);
  delay.connect(wet).connect(bus);

  // The bed: four held notes, a little out of tune with each other so they move, through a filter that slowly breathes.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  filter.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.value = 0.16;
  filter.connect(gain).connect(bus);
  const oscillators = CHORDS[0]!.map((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = index === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = [0, 5, -6, 4][index] ?? 0;
    const part = ctx.createGain();
    part.gain.value = [1, 0.6, 0.45, 0.22][index] ?? 0.2;
    osc.connect(part).connect(filter);
    osc.start();
    return osc;
  });
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 180;
  breath.connect(depth).connect(filter.frequency);
  breath.start();

  const runFilter = ctx.createBiquadFilter();
  runFilter.type = 'lowpass';
  runFilter.frequency.value = 700;
  runFilter.Q.value = 4;
  runFilter.connect(bus);
  runFilter.connect(echo);

  return { ctx, bus, echo, bed: { oscillators, gain, filter }, runFilter };
}

/** One note, on the synthesiser's clock. */
function playNote({ ctx, bus, echo, runFilter }: Rig, note: Note, when: number): void {
  const gain = ctx.createGain();
  const end = when + note.seconds;
  if (note.voice === 'tick') {
    // A grain of hiss through a high filter: a closed hi-hat, more or less.
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = note.freq;
    gain.gain.setValueAtTime(note.level * 0.5, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(high).connect(gain).connect(bus);
    source.start(when, Math.random() * 0.5);
    source.stop(end + 0.01);
    return;
  }
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(note.freq, when);
  if (note.voice === 'pulse') {
    // A soft thump: a low note that drops as it dies.
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note.freq * 1.9, when);
    osc.frequency.exponentialRampToValueAtTime(note.freq * 0.75, when + 0.09);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(note.level * 0.55, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(bus);
  } else if (note.voice === 'bass') {
    osc.type = 'triangle';
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(note.level * 0.3, when + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(bus);
  } else if (note.voice === 'bell') {
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(note.level * 0.11, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(bus);
    gain.connect(echo);
    // A faint overtone gives it the edge of a struck thing.
    const over = ctx.createOscillator();
    over.frequency.setValueAtTime(note.freq * 2.01, when);
    const overGain = ctx.createGain();
    overGain.gain.setValueAtTime(note.level * 0.03, when);
    overGain.gain.exponentialRampToValueAtTime(0.0001, when + note.seconds * 0.4);
    over.connect(overGain).connect(bus);
    over.start(when);
    over.stop(end + 0.02);
  } else {
    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(note.level * 0.12, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(runFilter);
  }
  osc.start(when);
  osc.stop(end + 0.02);
}

/** Schedules every step that falls inside the look-ahead window. */
function look(): void {
  if (!soundAwake() && rig === null) return;
  rig ??= build();
  if (!rig || rig.ctx.state !== 'running') return;
  const { ctx, bus, bed, runFilter } = rig;
  const hushed = performance.now() < hushedUntil;
  bus.gain.setTargetAtTime(hushed ? 0 : musicLevel(), ctx.currentTime, hushed ? 0.05 : 0.6);
  if (musicLevel() === 0 || hushed) {
    // Nothing to hear: let the beat lapse and pick it up fresh later.
    nextAt = 0;
    return;
  }
  scene = readScene();
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  // The bed thins out under a trace, so the run has the room.
  bed.gain.gain.setTargetAtTime(scene.mood === 'trace' ? 0.07 : scene.mood === 'connected' ? 0.13 : 0.16, ctx.currentTime, 1.2);
  runFilter.frequency.setTargetAtTime(runBrightness(scene.progress), ctx.currentTime, 0.3);
  while (nextAt < ctx.currentTime + AHEAD_SECONDS) {
    const chord = chordAt(step, scene.mood);
    if (chord !== chordNow) {
      chordNow = chord;
      // The held notes slide to the next chord over a few seconds.
      bed.oscillators.forEach((osc, index) => osc.frequency.setTargetAtTime(chord[index] ?? chord[0]!, nextAt, 1.4));
    }
    for (const note of notesAt(step, scene, Math.random())) playNote(rig, note, nextAt);
    nextAt += stepSeconds(tempoFor(scene));
    step++;
  }
}

/** Stops the music for a moment: the "caught" screen wants the silence. */
export function hushMusic(ms: number): void {
  hushedUntil = performance.now() + ms;
  if (rig) rig.bus.gain.setTargetAtTime(0, rig.ctx.currentTime, 0.04);
}

/** Starts the soundtrack. Call once, after the game has loaded. Nothing sounds until the player's first click or key. */
export function startMusic(): void {
  setInterval(look, LOOK_MS);
  onSoundChange(look);
  document.addEventListener('visibilitychange', look);
}
