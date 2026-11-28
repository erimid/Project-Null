/**
 * The background: the air of wherever the player is. At home it is a
 * warm, low room tone. Connected, it is the machine at the far end: a
 * hum on that server's own note and the rush of its cooling, colder and
 * tighter the better the place is guarded. Like everything else it is
 * synthesised as it plays, and it sits under the music and the effects.
 *
 * score.ts says what the air is (see Air); this file only plays it.
 */
import { findServer } from '../core/content';
import { noiseBuffer, onSoundChange, output, seeded, sound, soundAwake } from './audio';
import { HOME_AIR, serverAir, type Air } from './score';
import { content, session } from './session';
import { front } from './title/front';

/** Seconds for one air to give way to the next. */
const CROSSFADE = 1.6;
const LOOK_MS = 400;

interface Bed {
  readonly key: string;
  readonly gain: GainNode;
  readonly sources: AudioScheduledSourceNode[];
}

let bed: Bed | null = null;

/** Where the player is, as the background hears it. Null on the title screen: that has the music to itself. */
function readAir(): Air | null {
  if (front.get().screen !== 'desk') return null;
  const state = session.getState();
  // The last machine connected to that is somewhere to be, not a board or a relay on the way.
  const there = state.connections
    .map((connection) => findServer(content, connection.serverId))
    .findLast((server) => server && server.kind !== 'relay' && server.kind !== 'gateway');
  if (!there) return HOME_AIR;
  const { password, proxy, firewall, monitor } = there.security;
  return serverAir(there.id, Math.max(password, proxy, firewall, monitor), seeded(there.id)());
}

function build(ctx: AudioContext, out: AudioNode, air: Air): Bed {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const osc = (freq: number, level: number, wave: OscillatorType = 'sine'): void => {
    const node = ctx.createOscillator();
    node.type = wave;
    node.frequency.value = freq;
    const own = ctx.createGain();
    own.gain.value = level;
    node.connect(own).connect(gain);
    node.start();
    sources.push(node);
  };

  // The hum: the note, a copy a hair sharp so the two beat slowly, and the octave above for small speakers.
  osc(air.hum, 0.022);
  osc(air.hum * 1.004, 0.018);
  osc(air.hum * 2, 0.006 + 0.005 * air.guard, 'triangle');
  // A guarded place has a thin high whine on top, a fifth and some octaves up.
  if (air.guard > 0.5) osc(air.hum * 48, 0.0012 * air.guard);

  // The air: hiss through a band that sits higher and narrower in a colder room, breathing slowly.
  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx);
  hiss.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 260 + 900 * air.guard;
  band.Q.value = 0.7 + 1.6 * air.guard;
  const rushGain = ctx.createGain();
  rushGain.gain.value = 0.024;
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.07 + 0.08 * air.guard;
  const depth = ctx.createGain();
  depth.gain.value = 0.009;
  breath.connect(depth).connect(rushGain.gain);
  hiss.connect(band).connect(rushGain).connect(gain);
  hiss.start();
  breath.start();
  sources.push(hiss, breath);

  return { key: air.key, gain, sources };
}

function look(): void {
  if (!soundAwake() && bed === null) return;
  const sink = output('ambient');
  if (!sink || sink.ctx.state !== 'running') return;
  const { ctx, out } = sink;
  const settings = sound.get();
  const air = settings.on && settings.ambientVolume > 0 && !document.hidden ? readAir() : null;
  if ((air?.key ?? null) === (bed?.key ?? null)) return;
  if (bed) {
    const old = bed;
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, CROSSFADE / 4);
    setTimeout(() => {
      for (const source of old.sources) source.stop();
      old.gain.disconnect();
    }, CROSSFADE * 1500);
    bed = null;
  }
  if (air) {
    bed = build(ctx, out, air);
    bed.gain.gain.setTargetAtTime(1, ctx.currentTime, CROSSFADE / 3);
  }
}

/** Starts the background. Call once, after the game has loaded. Nothing sounds until the player's first click or key. */
export function startAmbient(): void {
  setInterval(look, LOOK_MS);
  onSoundChange(look);
  document.addEventListener('visibilitychange', look);
}
