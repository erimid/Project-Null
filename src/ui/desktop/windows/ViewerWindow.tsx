import { useEffect, useRef, useState } from 'preact/hooks';
import { fileContent } from '../../../core';
import type { CueDef, FileContent, Scene } from '../../../core/content';
import { seeded } from '../../audio';
import { playRecording, type Playing } from '../../recording';
import { useGame } from '../../hooks';
import { content } from '../../session';
import { useViewer, type OpenFile } from '../viewerStore';
import { Window } from '../Window';
import { useWindows } from '../windowStore';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Shows what is inside a file: text, a sound recording, a camera recording, or raw data. */
export function ViewerWindow() {
  const file = useViewer();
  const open = useWindows().viewer.open;
  // A copy on the gateway is what gets opened if there is one; it may have been decrypted since.
  const level = useGame((game) => {
    if (!file) return 0;
    const own = game.player.files.find((item) => item.name === file.name && item.from === file.serverId);
    return (own ?? game.servers[file.serverId]?.files.find((item) => item.name === file.name))?.encrypted ?? 0;
  });
  if (!file) return null;
  const inside = fileContent(content, file.serverId, file.name);
  return (
    <Window id="viewer" title={file.name} note={`${file.sizeGq} GB`}>
      {/* Closing the window unmounts the player, which stops the sound. */}
      {open && level > 0 && <Sealed name={file.name} level={level} />}
      {open && level === 0 && <Inside key={`${file.serverId}/${file.name}`} file={file} inside={inside} />}
    </Window>
  );
}

/** An encrypted file: nothing to read until a Decrypter has run on a copy. */
function Sealed({ name, level }: { name: string; level: number }) {
  const noise = seeded(`sealed/${name}`);
  const rows = Array.from({ length: 10 }, () =>
    Array.from({ length: 8 }, () => Math.floor(noise() * 0x10000).toString(16).padStart(4, '0')).join(' '),
  );
  return (
    <>
      <p class="viewer__note viewer__note--sealed">
        Encrypted, level <span class="data">{level}</span>. Copy it to your gateway and run a Decrypter on it from Programs to
        read it.
      </p>
      <pre class="doc doc--raw doc--sealed">{rows.join('\n')}</pre>
    </>
  );
}

function Inside({ file, inside }: { file: OpenFile; inside: FileContent | undefined }) {
  if (!inside) return <RawData name={file.name} />;
  if (inside.kind === 'text') return <pre class="doc">{inside.text}</pre>;
  return <Recording recording={inside} />;
}

/** A file nobody wrote readable contents for: show it the way a binary file looks. */
function RawData({ name }: { name: string }) {
  const random = seeded(name);
  const rows = Array.from({ length: 12 }, (_, row) => {
    const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const chars = bytes.map((byte) => (byte >= 33 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    return `${(row * 16).toString(16).padStart(6, '0')}  ${hex}  ${chars}`;
  });
  return (
    <>
      <p class="viewer__note">Packed data. Nothing in here is readable without the program that wrote it.</p>
      <pre class="doc doc--raw">{rows.join('\n')}</pre>
    </>
  );
}

type RecordingContent = Exclude<FileContent, { kind: 'text' }>;

/** Play, pause and seek for a sound or camera recording, with its lines shown as they come up. */
function Recording({ recording }: { recording: RecordingContent }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  // Where the recording was when it last started or stopped, and when that was.
  const anchor = useRef({ at: 0, startedMs: 0 });
  const sound = useRef<Playing | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const isVideo = recording.kind === 'video';

  const position = () =>
    Math.min(recording.seconds, anchor.current.at + (playing ? (performance.now() - anchor.current.startedMs) / 1000 : 0));

  const stopSound = () => {
    sound.current?.stop();
    sound.current = null;
  };
  const start = (from: number) => {
    stopSound();
    anchor.current = { at: from, startedMs: performance.now() };
    sound.current = playRecording(recording.lines, from, !isVideo);
    setPlaying(true);
  };
  const pause = () => {
    anchor.current = { at: position(), startedMs: 0 };
    stopSound();
    setPlaying(false);
  };
  const toggle = () => {
    if (playing) pause();
    else start(position() >= recording.seconds ? 0 : position());
  };
  const seek = (event: MouseEvent) => {
    const bar = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const to = Math.max(0, Math.min(1, (event.clientX - bar.left) / bar.width)) * recording.seconds;
    if (playing) start(to);
    else {
      anchor.current = { at: to, startedMs: 0 };
      setTime(to);
    }
  };

  useEffect(() => stopSound, []);

  // Redraw the picture and move the clock on every frame.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const now = position();
      setTime(now);
      const context = canvas.current?.getContext('2d');
      if (context) {
        if (recording.kind === 'video') drawCamera(context, recording.scene, recording.title, now, recording.seconds, playing);
        else drawSound(context, sound.current?.analyser ?? null);
      }
      if (playing && now >= recording.seconds) {
        anchor.current = { at: recording.seconds, startedMs: 0 };
        stopSound();
        setPlaying(false);
        return;
      }
      if (playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playing, recording]);

  const shown = recording.lines.filter((cue) => cue.at <= time);
  const current: CueDef | undefined = shown[shown.length - 1];

  return (
    <div class="player">
      <canvas
        ref={canvas}
        class={`player__screen${isVideo ? ' player__screen--video' : ''}`}
        width={608}
        height={isVideo ? 342 : 96}
        aria-label={recording.title}
      />
      {!isVideo && <p class="player__title">{recording.title}</p>}
      <div class="player__controls">
        <button type="button" class="btn btn--go player__play" onClick={toggle}>
          {playing ? 'Pause' : time >= recording.seconds ? 'Play again' : 'Play'}
        </button>
        <div class="player__track" onClick={seek} role="presentation">
          <span class="player__played" style={{ width: `${(time / recording.seconds) * 100}%` }} />
        </div>
        <span class="player__time data">
          {clock(time)} / {clock(recording.seconds)}
        </span>
      </div>
      <ol class="player__lines" aria-live="polite">
        {shown.length === 0 && <li class="player__line player__line--idle">Press Play.</li>}
        {shown.map((cue) => (
          <li key={cue.at} class={`player__line${cue === current ? ' is-current' : ''}`}>
            <span class="player__at data">{clock(cue.at)}</span>
            <span>
              {cue.who && <strong class="player__who">{cue.who} </strong>}
              {cue.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The sound as bars, loudest in the middle. A flat line while nothing plays. */
function drawSound(context: CanvasRenderingContext2D, analyser: AnalyserNode | null): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  const bars = 64;
  const levels = new Uint8Array(analyser ? analyser.frequencyBinCount : bars);
  analyser?.getByteFrequencyData(levels);
  const step = width / bars;
  for (let i = 0; i < bars; i++) {
    // Mirror the spectrum so the picture is symmetrical.
    const bin = Math.abs(i - bars / 2) * 1.2;
    const size = Math.max(2, ((levels[Math.floor(bin)] ?? 0) / 255) * (height - 8));
    context.fillStyle = `rgba(78, 230, 200, ${0.35 + (size / height) * 0.65})`;
    context.fillRect(i * step + 1, (height - size) / 2, step - 2, size);
  }
}

/** One frame of a camera recording. Everything is drawn from the time alone, so seeking just works. */
function drawCamera(
  context: CanvasRenderingContext2D,
  scene: Scene,
  title: string,
  time: number,
  seconds: number,
  playing: boolean,
): void {
  const { width: w, height: h } = context.canvas;
  const part = time / seconds;
  context.fillStyle = '#060b0a';
  context.fillRect(0, 0, w, h);
  context.lineWidth = 1.5;
  const line = 'rgba(150, 215, 190, 0.5)';
  const dim = 'rgba(150, 215, 190, 0.22)';
  const body = 'rgba(190, 240, 220, 0.85)';

  /** A standing person, feet at (x, y), `size` tall. */
  const person = (x: number, y: number, size: number, alpha = 1) => {
    context.globalAlpha = alpha;
    context.fillStyle = body;
    context.beginPath();
    context.arc(x, y - size * 0.9, size * 0.1, 0, Math.PI * 2);
    context.fill();
    // Legs swing a little as they walk.
    const swing = Math.sin(time * 7) * size * 0.06;
    context.fillRect(x - size * 0.11, y - size * 0.78, size * 0.22, size * 0.45);
    context.fillRect(x - size * 0.1 + swing, y - size * 0.34, size * 0.08, size * 0.34);
    context.fillRect(x + size * 0.02 - swing, y - size * 0.34, size * 0.08, size * 0.34);
    context.globalAlpha = 1;
  };
  const between = (from: number, to: number) => Math.max(0, Math.min(1, (part - from) / (to - from)));

  if (scene === 'corridor') {
    const vx = w * 0.5;
    const vy = h * 0.42;
    context.strokeStyle = line;
    context.beginPath();
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
      context.moveTo(x, y);
      context.lineTo(vx + (x - vx) * 0.12, vy + (y - vy) * 0.12);
    }
    context.strokeRect(vx - w * 0.06, vy - h * 0.05, w * 0.12, h * 0.12);
    context.stroke();
    // Doors along the left wall, the nearest one lit.
    context.strokeStyle = dim;
    for (const depth of [0.75, 0.5, 0.3]) {
      const x = vx - w * 0.5 * depth;
      const top = vy - h * 0.3 * depth;
      const bottom = vy + (h - vy) * depth;
      context.strokeRect(x, top, w * 0.07 * depth, bottom - top);
    }
    const lit = part > 0.45 && part < 0.72;
    context.fillStyle = lit ? 'rgba(255, 240, 190, 0.35)' : 'rgba(150, 215, 190, 0.05)';
    context.fillRect(vx - w * 0.25, vy - h * 0.15, w * 0.035, h * 0.44);
    // Someone walks up the corridor, goes in, comes out, walks back.
    const out = between(0.25, 0.45);
    const back = between(0.72, 0.95);
    if (part > 0.25 && part < 0.45) person(vx + w * 0.3 - out * w * 0.5, h * 0.98 - out * h * 0.22, h * (0.75 - out * 0.3));
    if (part >= 0.72 && part < 0.95) person(vx - w * 0.2 + back * w * 0.5, h * 0.76 + back * h * 0.22, h * (0.45 + back * 0.3));
  } else if (scene === 'gate') {
    const ground = h * 0.72;
    context.strokeStyle = dim;
    context.beginPath();
    for (let x = 0; x < w; x += 22) {
      context.moveTo(x, h * 0.28);
      context.lineTo(x, ground);
    }
    context.moveTo(0, h * 0.28);
    context.lineTo(w, h * 0.28);
    context.stroke();
    context.strokeStyle = line;
    context.beginPath();
    context.moveTo(0, ground);
    context.lineTo(w, ground);
    context.stroke();
    // The booth, and a barrier that lifts as the truck arrives.
    context.strokeRect(w * 0.16, ground - h * 0.3, w * 0.1, h * 0.3);
    const lift = between(0.42, 0.55) * (1 - between(0.85, 0.97));
    context.save();
    context.translate(w * 0.27, ground - h * 0.12);
    context.rotate(-lift * 1.25);
    context.fillStyle = 'rgba(255, 120, 120, 0.8)';
    context.fillRect(0, -3, w * 0.36, 6);
    context.restore();
    // The truck comes in from the right, waits, and drives through.
    const arrive = between(0.2, 0.42);
    const leave = between(0.56, 0.86);
    const x = w * 1.05 - arrive * w * 0.38 - leave * w * 1.1;
    if (part > 0.2) {
      context.fillStyle = 'rgba(8, 14, 13, 0.95)';
      context.strokeStyle = body;
      context.fillRect(x, ground - h * 0.3, w * 0.34, h * 0.26);
      context.strokeRect(x, ground - h * 0.3, w * 0.34, h * 0.26);
      context.fillRect(x - w * 0.09, ground - h * 0.2, w * 0.09, h * 0.16);
      context.strokeRect(x - w * 0.09, ground - h * 0.2, w * 0.09, h * 0.16);
      context.fillStyle = body;
      for (const wheel of [-0.05, 0.06, 0.27]) {
        context.beginPath();
        context.arc(x + w * wheel, ground - h * 0.02, h * 0.035, 0, Math.PI * 2);
        context.fill();
      }
      // Headlights.
      const beam = context.createLinearGradient(x - w * 0.09, 0, x - w * 0.4, 0);
      beam.addColorStop(0, 'rgba(255, 250, 210, 0.45)');
      beam.addColorStop(1, 'rgba(255, 250, 210, 0)');
      context.fillStyle = beam;
      context.beginPath();
      context.moveTo(x - w * 0.09, ground - h * 0.1);
      context.lineTo(x - w * 0.4, ground - h * 0.2);
      context.lineTo(x - w * 0.4, ground);
      context.fill();
    }
  } else {
    // A room seen from a high corner: back wall, tables, terminals.
    context.strokeStyle = line;
    context.strokeRect(w * 0.14, h * 0.14, w * 0.72, h * 0.42);
    context.beginPath();
    for (const [x, y, tx, ty] of [[0, 0, 0.14, 0.14], [w, 0, 0.86, 0.14], [0, h, 0.14, 0.56], [w, h, 0.86, 0.56]] as const) {
      context.moveTo(x, y);
      context.lineTo(w * tx, h * ty);
    }
    context.stroke();
    for (const [x, glow] of [[0.24, 0.5], [0.44, 0.9], [0.64, 0.3]] as const) {
      context.strokeStyle = dim;
      context.strokeRect(w * x, h * 0.62, w * 0.14, h * 0.07);
      context.fillStyle = `rgba(95, 212, 255, ${glow * (0.5 + 0.1 * Math.sin(time * 9 + x * 20))})`;
      context.fillRect(w * (x + 0.045), h * 0.54, w * 0.05, h * 0.07);
    }
    // One reader sits at the middle terminal the whole time.
    person(w * 0.52, h * 0.86, h * 0.34);
    // A visitor comes in from the door on the right, stands close, and leaves.
    const come = between(0.3, 0.5);
    const go = between(0.75, 0.95);
    if (part > 0.3 && part < 0.95) person(w * 0.95 - come * w * 0.35 + go * w * 0.4, h * 0.9, h * 0.42);
    if (part > 0.55 && part < 0.72) {
      context.fillStyle = 'rgba(255, 240, 190, 0.9)';
      context.fillRect(w * 0.555, h * 0.66, w * 0.02, h * 0.012);
    }
  }

  // Camera dressing: grain, scan lines, a dark edge, and the stamp.
  const grain = seeded(`${Math.floor(time * 24)}`);
  context.fillStyle = 'rgba(200, 255, 235, 0.07)';
  for (let i = 0; i < 260; i++) context.fillRect(grain() * w, grain() * h, 2, 2);
  context.fillStyle = 'rgba(0, 0, 0, 0.22)';
  for (let y = 0; y < h; y += 4) context.fillRect(0, y, w, 1);
  const edge = context.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  context.fillStyle = edge;
  context.fillRect(0, 0, w, h);
  context.font = '14px "Share Tech Mono", monospace';
  context.fillStyle = 'rgba(220, 255, 240, 0.9)';
  context.fillText(title, 14, 24);
  context.fillText(clock(time), w - 52, h - 14);
  if (playing && Math.floor(time * 2) % 2 === 0) {
    context.fillStyle = '#ff3b4e';
    context.beginPath();
    context.arc(w - 22, 19, 5, 0, Math.PI * 2);
    context.fill();
  }
}
