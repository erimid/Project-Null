/**
 * Plays the sound of a recording: a bed of tape hiss, and for each line a
 * voice. The voices are made of short buzzing syllables shaped to sound
 * like speech heard through a wall. The words themselves are shown on
 * screen by the viewer.
 */
import type { CueDef } from '../core/content';
import { noiseBuffer, output, seeded } from './audio';

export interface Playing {
  /** For drawing the sound as it plays. Null where sound isn't available. */
  readonly analyser: AnalyserNode | null;
  stop(): void;
}

const SYLLABLE_SECONDS = 0.17;

/**
 * Starts the recording from `fromSeconds`. With `voices` false only the
 * hiss plays (camera recordings have no sound track worth the name).
 */
export function playRecording(lines: readonly CueDef[], fromSeconds: number, voices: boolean): Playing {
  const sink = output();
  if (!sink) return { analyser: null, stop: () => undefined };
  const { ctx, out } = sink;
  const bus = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  bus.connect(analyser);
  analyser.connect(out);
  const sources: AudioScheduledSourceNode[] = [];

  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx);
  hiss.loop = true;
  const hissTone = ctx.createBiquadFilter();
  hissTone.type = 'bandpass';
  hissTone.frequency.value = 2400;
  hissTone.Q.value = 0.4;
  const hissLevel = ctx.createGain();
  hissLevel.gain.value = voices ? 0.035 : 0.06;
  hiss.connect(hissTone).connect(hissLevel).connect(bus);
  hiss.start();
  sources.push(hiss);

  if (voices) {
    const start = ctx.currentTime + 0.05;
    for (const cue of lines) {
      // Each speaker has their own pitch.
      const pitch = 95 + seeded(cue.who ?? 'voice')() * 110;
      const random = seeded(cue.text);
      let at = cue.at - fromSeconds;
      for (const word of cue.text.split(/\s+/)) {
        const syllables = Math.max(1, Math.round(word.length / 3));
        for (let i = 0; i < syllables; i++, at += SYLLABLE_SECONDS) {
          if (at < 0) continue;
          const when = start + at;
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          const note = pitch * (0.9 + random() * 0.3);
          osc.frequency.setValueAtTime(note, when);
          osc.frequency.linearRampToValueAtTime(note * 0.92, when + SYLLABLE_SECONDS);
          const vowel = ctx.createBiquadFilter();
          vowel.type = 'bandpass';
          vowel.frequency.value = 450 + random() * 1300;
          vowel.Q.value = 5;
          const shape = ctx.createGain();
          shape.gain.setValueAtTime(0, when);
          shape.gain.linearRampToValueAtTime(0.5, when + 0.025);
          shape.gain.linearRampToValueAtTime(0, when + SYLLABLE_SECONDS * 0.85);
          osc.connect(vowel).connect(shape).connect(bus);
          osc.start(when);
          osc.stop(when + SYLLABLE_SECONDS);
          sources.push(osc);
        }
        // A short gap between words.
        at += 0.05;
      }
    }
  }

  return {
    analyser,
    stop() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already finished.
        }
      }
      bus.disconnect();
      analyser.disconnect();
    },
  };
}
