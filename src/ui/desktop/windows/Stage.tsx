/**
 * The stage: a wide strip that shows the program running on a connection
 * (or on the gateway), large enough to watch. Each kind of program has its
 * own show, and three of them have something optional to do with your
 * hands (see core/play.ts); the firewall's port line-up plays here too.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  CATCH_CELLS,
  MARK_CELLS,
  catchFlash,
  catchLocked,
  findProgram,
  findServer,
  keyFits,
  replyMark,
  ringAngle,
  ringTolerance,
  type GameState,
  type Task,
} from '../../../core';
import { useGame } from '../../hooks';
import { content, session } from '../../session';
import { stageSound } from '../../sfx';
import { reducedMotion } from '../calm';
import { Icon, programIcon } from '../Icon';
import { describeTarget } from '../TaskProgress';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A made-up password for show. Always the same for the same account. */
export function fakePassword(seed: string): string {
  let hash = 2166136261;
  let out = '';
  for (let i = 0; i < CATCH_CELLS; i++) {
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    hash = Math.imul(hash ^ i, 16777619);
    out += GLYPHS[(hash >>> 0) % GLYPHS.length];
  }
  return out;
}

/** The letters of a password being broken, as they stand: found ones stay, the rest keep spinning. */
export function crackedSoFar(task: Task, secret: string): string {
  const locked = catchLocked(task);
  const spin = Math.floor(task.progressMs / 70);
  return [...secret].map((char, i) => (locked[i] ? char : GLYPHS[(spin * 7 + i * 13) % GLYPHS.length])).join('');
}

const taskOf = (game: GameState, taskId: string) => game.tasks.find((item) => item.id === taskId);
const share = (task: Task) => (task.durationMs > 0 ? Math.min(1, task.progressMs / task.durationMs) : 1);

/** True while this task still has something for the player's hands. */
export function handsOnOpen(task: Task): boolean {
  if (task.puzzle) return task.puzzle.locked.some((locked) => !locked);
  const play = task.play;
  if (!play) return false;
  return play.kind === 'catch' ? true : play.result === 'open';
}

/** Plays a sound each time `count` goes up. */
function useCountSound(count: number, sound: (count: number) => void) {
  const last = useRef(count);
  useEffect(() => {
    if (count > last.current) sound(count);
    last.current = count;
  }, [count]);
}

function Show({ children, text, status, tone }: { children: ComponentChildren; text: ComponentChildren; status: ComponentChildren; tone?: string }) {
  return (
    <div class={`stage__show${tone ? ` ${tone}` : ''}`}>
      <div class="stage__act">{children}</div>
      <div class="stage__text">
        {text}
        <p class="stage__status data">{status}</p>
      </div>
    </div>
  );
}

/** The password, large: a letter locks with a tick, and now and then one flashes to be caught. */
function CrackShow({ taskId, secret }: { taskId: string; secret: string }) {
  const frame = useGame((game) => {
    const task = taskOf(game, taskId);
    if (!task || task.play?.kind !== 'catch') return '';
    return `${crackedSoFar(task, secret)}|${catchLocked(task).map((locked) => (locked ? 1 : 0)).join('')}|${catchFlash(task) ?? -1}|${task.play.caught}|${task.play.missed}`;
  });
  const [shown = '', lockedText = '', litText = '-1', caughtText = '0', missedText = '0'] = frame.split('|');
  const locked = [...lockedText].map((value) => value === '1');
  const count = locked.filter(Boolean).length;
  const lit = Number(litText);
  const caught = Number(caughtText);
  const missed = Number(missedText);
  useCountSound(count, (n) => stageSound('letter', n));
  useCountSound(caught, () => stageSound('caught'));
  useCountSound(missed, () => stageSound('miss'));
  if (!frame) return null;
  return (
    <Show
      text={
        <p>
          The code locks in one letter at a time. Now and then a letter still spinning <strong>lights up</strong>: press it while it is lit and it
          locks early. A wrong press costs {content.rules.catchMissSeconds} {content.rules.catchMissSeconds === 1 ? 'second' : 'seconds'}. Or leave it to run.
        </p>
      }
      status={`${count} / ${CATCH_CELLS} locked${caught > 0 ? ` · ${caught} caught` : ''}`}
    >
      <div class="crack" role="group" aria-label="Password letters">
        {[...shown].map((char, cell) => (
          <button
            key={cell}
            type="button"
            class={`crack__cell data${locked[cell] ? ' is-locked' : ''}${cell === lit ? ' is-lit' : ''}`}
            aria-label={locked[cell] ? `Letter ${cell + 1}, locked` : cell === lit ? `Letter ${cell + 1}, lit` : `Letter ${cell + 1}`}
            data-quiet
            onPointerDown={(event) => {
              event.preventDefault();
              session.dispatch({ type: 'catchLetter', taskId, cell });
            }}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                session.dispatch({ type: 'catchLetter', taskId, cell });
              }
            }}
          >
            {cell === lit ? secret[cell] : char}
          </button>
        ))}
      </div>
    </Show>
  );
}

/** A mark: nine cells, some lit. */
function Sigil({ mark, label }: { mark: number; label?: string }) {
  return (
    <span class="sigil" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: MARK_CELLS }, (_, cell) => (
        <i key={cell} class={mark & (1 << cell) ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/** A made-up address for one of the proxy's answers. */
function fakeAddress(seed: number, index: number): string {
  let hash = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 7, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
  return `${10 + (hash % 190)}.${(hash >>> 8) & 255}.${(hash >>> 16) & 255}.${1 + ((hash >>> 24) % 250)}`;
}

const MIRRORS = 6;

/** The proxy peeling back mirror by mirror, and its five answers to pick the real one from. */
function ProxyShow({ taskId }: { taskId: string }) {
  const frame = useGame((game) => {
    const task = taskOf(game, taskId);
    if (!task || task.play?.kind !== 'pick') return '';
    return `${Math.min(MIRRORS - 1, Math.floor(share(task) * MIRRORS))}|${task.play.struck.map((struck) => (struck ? 1 : 0)).join('')}|${task.play.result}|${task.play.missed}`;
  });
  const [peeledText = '0', struckText = '', result = 'open', missedText = '0'] = frame.split('|');
  const peeled = Number(peeledText);
  const missed = Number(missedText);
  useCountSound(peeled, (n) => stageSound('peel', n));
  useCountSound(result === 'won' ? 1 : 0, () => stageSound('caught'));
  useCountSound(missed, () => stageSound('miss'));
  const play = taskOf(session.getState(), taskId)?.play;
  if (!frame || play?.kind !== 'pick') return null;
  const cut = Math.round(content.rules.pickCutFactor * 100);
  return (
    <Show
      text={
        result === 'won' ? (
          <p>That is the real one. The bypass stops peeling mirrors and goes straight at it.</p>
        ) : (
          <p>
            The proxy answers from {play.marks.length} addresses, and all but one are mirrors. The real one carries <strong>the same mark as the reply</strong>.
            Name it and the bypass takes {cut}% off the time left. A mirror named by mistake costs {content.rules.pickMissSeconds} seconds. Or leave it to
            peel them all.
          </p>
        )
      }
      status={`mirror ${peeled} of ${MIRRORS} peeled${result === 'won' ? ' · real address found' : ''}`}
    >
      <div class="peel" aria-hidden="true">
        {Array.from({ length: MIRRORS }, (_, i) => (
          <span key={i} class={`peel__mirror${i < peeled ? ' is-gone' : i === peeled ? ' is-going' : ''}`} />
        ))}
      </div>
      <div class={`pick is-${result}`}>
        <span class="pick__reply">
          <span class="pick__label">Reply</span>
          <Sigil mark={replyMark(play)} label="The mark on the reply" />
        </span>
        <span class="pick__options" role="group" aria-label="The proxy's addresses">
          {play.marks.map((mark, option) => {
            const struck = struckText[option] === '1';
            const real = result === 'won' && option === play.real;
            return (
              <button
                key={option}
                type="button"
                class={`pick__option${struck ? ' is-struck' : ''}${real ? ' is-real' : ''}`}
                disabled={struck || result !== 'open'}
                aria-label={`Address ${option + 1}${struck ? ', ruled out' : real ? ', the real one' : ''}`}
                onClick={() => session.dispatch({ type: 'pickAddress', taskId, option })}
              >
                <Sigil mark={mark} />
                <span class="data pick__address">{fakeAddress(play.seed, option)}</span>
              </button>
            );
          })}
        </span>
      </div>
    </Show>
  );
}

const TOOTH_UNIT = 9;
const KEY_COLUMN = 22;

/** The decrypter: cipher turning to plain text, and a key to slide along the pins until its teeth fit. */
function KeyShow({ taskId }: { taskId: string }) {
  const frame = useGame((game) => {
    const task = taskOf(game, taskId);
    if (!task || task.play?.kind !== 'key') return '';
    return `${Math.floor(share(task) * 100)}|${task.play.pos}|${task.play.result}|${task.play.missed}`;
  });
  const [percentText = '0', posText = '0', result = 'open', missedText = '0'] = frame.split('|');
  const pos = Number(posText);
  const missed = Number(missedText);
  useCountSound(result === 'won' ? 1 : 0, () => stageSound('caught'));
  useCountSound(missed, () => stageSound('miss'));
  const play = taskOf(session.getState(), taskId)?.play;
  if (!frame || play?.kind !== 'key') return null;
  const last = play.strip.length - play.lock.length;
  const slide = (to: number) => session.dispatch({ type: 'slideKey', taskId, pos: to });
  const fits = keyFits(play, pos);
  const cut = Math.round(content.rules.keyCutFactor * 100);
  const open = result === 'open';
  // Tallest pin plus the longest tooth: the room between the key's spine and the floor.
  const room = 4 * TOOTH_UNIT;
  return (
    <Show
      text={
        open ? (
          <p>
            Slide the key along the pins until every tooth <strong>rests on its pin</strong> with no gap and no overlap, then turn it. A fit takes {cut}%
            off the time left. A key turned in the wrong place jams for {content.rules.keyMissSeconds} seconds. Or leave it to grind through.
          </p>
        ) : (
          <p>The key turned. The rest of the file falls open quickly.</p>
        )
      }
      status={`${percentText}% decrypted${result === 'won' ? ' · key turned' : missed > 0 ? ` · ${missed} jammed` : ''}`}
    >
      <div class={`key is-${result}${open && fits ? ' is-fit' : ''}`}>
        <svg
          class="key__lock"
          viewBox={`0 0 ${play.strip.length * KEY_COLUMN} ${room + 16}`}
          role="group"
          aria-label={`Key at place ${pos + 1} of ${last + 1}`}
        >
          {/* The pins: one column each, standing on the floor. A press slides the key to start there. */}
          {play.strip.map((height, column) => (
            <g key={column} class="key__pin" onPointerDown={() => open && slide(column - Math.floor(play.lock.length / 2))}>
              <rect x={column * KEY_COLUMN} y={0} width={KEY_COLUMN} height={room + 16} class="key__hit" />
              <rect x={column * KEY_COLUMN + 3} y={10 + room - height * TOOTH_UNIT} width={KEY_COLUMN - 6} height={height * TOOTH_UNIT + 6} rx={2} />
            </g>
          ))}
          {/* The key: a spine with teeth hanging from it. */}
          <g class="key__key" style={{ transform: `translateX(${pos * KEY_COLUMN}px)` }}>
            <rect x={0} y={0} width={play.lock.length * KEY_COLUMN} height={8} rx={3} class="key__spine" />
            {play.lock.map((height, i) => (
              <rect key={i} x={i * KEY_COLUMN + 5} y={8} width={KEY_COLUMN - 10} height={2 + room - height * TOOTH_UNIT} rx={2} />
            ))}
          </g>
        </svg>
        <div class="key__controls">
          <button type="button" class="btn" disabled={!open || pos <= 0} aria-label="Slide the key left" onClick={() => slide(pos - 1)}>
            ‹
          </button>
          <button type="button" class="btn btn--go" disabled={!open} onClick={() => session.dispatch({ type: 'turnKey', taskId })}>
            Turn key
          </button>
          <button type="button" class="btn" disabled={!open || pos >= last} aria-label="Slide the key right" onClick={() => slide(pos + 1)}>
            ›
          </button>
        </div>
      </div>
    </Show>
  );
}

const LINEUP_SIZE = 240;
/** The innermost ring's radius, and how far apart the rings sit. Each ring's whole band takes a click. */
const RING_INNER = 24;
const RING_GAP = 18;
const LINEUP_CENTRE = LINEUP_SIZE / 2;

/**
 * The hands-on shortcut for a firewall bypass: rings turn, each carrying
 * one port. Click a ring as its port crosses the marker at the top.
 */
function PortLineup({ taskId, rings }: { taskId: string; rings: number }) {
  // One short text per frame, so the rings redraw as they turn.
  const frame = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    if (!task?.puzzle) return '';
    const angles = task.puzzle.locked.map((locked, ring) => (locked ? 'L' : ringAngle(task, ring).toFixed(1)));
    return `${angles.join(',')}|${Math.max(0, Math.ceil((task.durationMs - task.progressMs) / 1000))}`;
  });
  const [anglesText = '', secondsLeft = '0'] = frame.split('|');
  const angles = anglesText.split(',');
  const lockedCount = angles.filter((angle) => angle === 'L').length;
  useCountSound(lockedCount, (n) => stageSound('letter', n));
  if (!frame) return null;
  const tolerance = ringTolerance(session.getState(), content);
  const lock = (ring: number) => session.dispatch({ type: 'lockRing', taskId, ring });
  const point = (radius: number, degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: LINEUP_CENTRE + radius * Math.cos(radians), y: LINEUP_CENTRE + radius * Math.sin(radians) };
  };
  const outer = RING_INNER + (rings - 1) * RING_GAP + RING_GAP / 2 + 3;
  const left = point(outer, -tolerance);
  const right = point(outer, tolerance);

  return (
    <div class="lineup">
      <svg class="lineup__dial" viewBox={`0 0 ${LINEUP_SIZE} ${LINEUP_SIZE}`} role="group" aria-label="Port line-up">
        {/* The window the port has to be in. */}
        <path d={`M${LINEUP_CENTRE} ${LINEUP_CENTRE}L${left.x} ${left.y}A${outer} ${outer} 0 0 1 ${right.x} ${right.y}Z`} class="lineup__window" />
        <path d={`M${LINEUP_CENTRE - 6} ${LINEUP_CENTRE - outer - 12}h12l-6 9z`} class="lineup__marker" />
        {angles.map((angle, ring) => {
          const radius = RING_INNER + ring * RING_GAP;
          const locked = angle === 'L';
          const port = point(radius, locked ? 0 : Number(angle));
          return (
            <g
              key={ring}
              class={`lineup__ring${locked ? ' is-locked' : ''}`}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-label={`Ring ${ring + 1}${locked ? ', locked' : ''}`}
              aria-disabled={locked}
              onPointerDown={() => !locked && lock(ring)}
              onKeyDown={(event: KeyboardEvent) => {
                if (!locked && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  lock(ring);
                }
              }}
            >
              <circle cx={LINEUP_CENTRE} cy={LINEUP_CENTRE} r={radius} class="lineup__hit" />
              <circle cx={LINEUP_CENTRE} cy={LINEUP_CENTRE} r={radius} class="lineup__track" />
              <circle cx={port.x} cy={port.y} r={6.5} class="lineup__port" />
            </g>
          );
        })}
      </svg>
      <div class="lineup__text">
        <h3 class="map__heading">Line up the ports</h3>
        <p>
          Click a ring as its port crosses the marker at the top. Each ring you lock shortens the bypass, and locking all {rings} finishes it. A miss costs{' '}
          {content.rules.ringMissSeconds} seconds. Left alone, the program locks them itself, one at a time, as the ports come round.
        </p>
        <p class="lineup__status data">
          {lockedCount} / {rings} locked · {secondsLeft}s left
        </p>
      </div>
    </div>
  );
}

const BLOCKS = 28;

/** A file on its way: blocks crossing from one end to the other, or going out one by one. */
function StreamShow({ taskId, from, to, sizeGb, mode }: { taskId: string; from: string; to: string; sizeGb: number; mode: 'copy' | 'delete' }) {
  const filled = useGame((game) => {
    const task = taskOf(game, taskId);
    return task ? Math.floor(share(task) * BLOCKS) : BLOCKS;
  });
  useCountSound(filled, (n) => n % 4 === 0 && stageSound(mode === 'delete' ? 'wipe' : 'block', n));
  const doneGb = ((sizeGb * filled) / BLOCKS).toFixed(1);
  return (
    <div class={`stream stream--${mode}`}>
      <span class="stream__end data">{from}</span>
      <span class="stream__blocks" aria-hidden="true">
        {Array.from({ length: BLOCKS }, (_, i) => (
          <i key={i} class={i < filled ? 'is-done' : i === filled ? 'is-next' : undefined} />
        ))}
      </span>
      <span class="stream__end data">{to}</span>
      <span class="stream__count data">
        {doneGb} / {sizeGb} GB
      </span>
    </div>
  );
}

/** The log lines being scrubbed, struck out one after another. */
function ScrubShow({ taskId, lines }: { taskId: string; lines: readonly string[] }) {
  const done = useGame((game) => {
    const task = taskOf(game, taskId);
    return task ? Math.floor(share(task) * lines.length) : lines.length;
  });
  useCountSound(done, (n) => stageSound('wipe', n));
  const shown = lines.slice(0, 4);
  return (
    <div class="scrubshow">
      <ul class="scrubshow__lines data">
        {shown.map((line, i) => (
          <li key={i} class={i < done ? 'is-gone' : i === done ? 'is-going' : undefined}>
            {line}
          </li>
        ))}
      </ul>
      <span class="stream__count data">
        {Math.min(done, lines.length)} / {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        {lines.length > shown.length ? ` · ${lines.length - shown.length} more below` : ''}
      </span>
    </div>
  );
}

const SWEEP = 20;

/** A plain show for the rest: a row of cells a sweep works through, with a line saying what it is doing. */
function SweepShow({ taskId, tone, text }: { taskId: string; tone: string; text: string }) {
  const filled = useGame((game) => {
    const task = taskOf(game, taskId);
    return task ? Math.floor(share(task) * SWEEP) : SWEEP;
  });
  useCountSound(filled, (n) => n % 4 === 0 && stageSound('block', n));
  return (
    <div class={`sweep sweep--${tone}`}>
      <span class="sweep__cells" aria-hidden="true">
        {Array.from({ length: SWEEP }, (_, i) => (
          <i key={i} class={i < filled ? 'is-done' : i === filled ? 'is-next' : undefined} />
        ))}
      </span>
      <span class="sweep__text">{text}</span>
    </div>
  );
}

/** The show for one task. */
function showFor(game: GameState, task: Task): ComponentChildren {
  const target = task.target;
  const connection = game.connections.find((item) => item.id === task.connectionId);
  const server = connection && findServer(content, connection.serverId);
  const host = server?.hostname ?? 'server';
  switch (target.kind) {
    case 'password':
      return <CrackShow taskId={task.id} secret={fakePassword(`${connection?.serverId}/${target.user}`)} />;
    case 'proxy':
      return <ProxyShow taskId={task.id} />;
    case 'firewall':
      return task.puzzle ? <PortLineup taskId={task.id} rings={task.puzzle.locked.length} /> : null;
    case 'decrypt':
      return <KeyShow taskId={task.id} />;
    case 'monitor':
      return <SweepShow taskId={task.id} tone="blind" text="Feeding the monitor a loop of nothing happening. When it takes, the watch goes blind." />;
    case 'copyFile': {
      const file = connection && game.servers[connection.serverId]?.files.find((item) => item.name === target.file);
      return <StreamShow taskId={task.id} from={host} to="gateway" sizeGb={file?.sizeGq ?? 0} mode="copy" />;
    }
    case 'uploadFile': {
      const file = game.player.files.find((item) => item.name === target.file);
      return <StreamShow taskId={task.id} from="gateway" to={host} sizeGb={file?.sizeGq ?? 0} mode="copy" />;
    }
    case 'deleteFile': {
      const file = connection && game.servers[connection.serverId]?.files.find((item) => item.name === target.file);
      return <StreamShow taskId={task.id} from={target.file} to="gone" sizeGb={file?.sizeGq ?? 0} mode="delete" />;
    }
    case 'deleteLog': {
      const logs = (connection && game.servers[connection.serverId]?.logs) ?? [];
      const lines = target.logIds.map((id) => logs.find((entry) => entry.id === id)?.text ?? 'log line');
      return <ScrubShow taskId={task.id} lines={lines} />;
    }
    case 'scan':
      return <SweepShow taskId={task.id} tone="scan" text={`Knocking on ${findServer(content, target.serverId)?.name ?? 'the server'}'s ports and reading what answers.`} />;
    case 'decompile':
      return <SweepShow taskId={task.id} tone="scan" text={`Taking ${target.file} apart to see what it is made of.`} />;
    case 'build':
      return <SweepShow taskId={task.id} tone="build" text="Fitting the modules and compiling the build." />;
  }
}

/** Seconds a task still needs. */
function TimeLeft({ taskId }: { taskId: string }) {
  const seconds = useGame((game) => {
    const task = taskOf(game, taskId);
    return task ? Math.max(0, Math.ceil((task.durationMs - task.progressMs) / 1000)) : 0;
  });
  return <span class="stage__time data">{seconds}s</span>;
}

function Bar({ taskId }: { taskId: string }) {
  const percent = useGame((game) => {
    const task = taskOf(game, taskId);
    return task ? Math.floor(share(task) * 100) : 100;
  });
  return (
    <span class="stage__bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span class="stage__fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * What is running over one connection (or, with null, on the gateway).
 * One program is in front; the others wait as chips to be brought forward.
 * A program with something to do by hand keeps the front until it ends, so
 * nothing moves under the pointer.
 */
export function Stage({ connectionId }: { connectionId: string | null }) {
  const ids = useGame((game) =>
    game.tasks
      .filter((task) => task.connectionId === connectionId)
      .map((task) => task.id)
      .join(','),
  );
  const traced = useGame((game) => {
    const connection = game.connections.find((item) => item.id === connectionId);
    return connection?.trace.status === 'active' && connection.monitor.blindMs <= 0;
  });
  const front = useRef<string | null>(null);
  const box = useRef<HTMLElement>(null);
  const [, redraw] = useState(0);
  // A program with something to do by hand brings the stage into view when it starts: the button that started it may be far below.
  const showing = ids !== '';
  useEffect(() => {
    const first = session.getState().tasks.find((task) => task.connectionId === connectionId);
    if (showing && first && handsOnOpen(first)) box.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [showing]);
  if (!ids) {
    front.current = null;
    return null;
  }
  const game = session.getState();
  const tasks = ids
    .split(',')
    .map((id) => taskOf(game, id))
    .filter((task) => task !== undefined);
  if (tasks.length === 0) return null;
  if (!tasks.some((task) => task.id === front.current)) {
    front.current = (tasks.find(handsOnOpen) ?? tasks[tasks.length - 1]!).id;
  }
  const task = tasks.find((item) => item.id === front.current)!;
  const program = findProgram(content, task.programId, game);
  const others = tasks.filter((item) => item !== task);
  return (
    <section ref={box} class={`stage stage--${task.target.kind}${traced ? ' is-traced' : ''}`} aria-label={connectionId ? 'Running on this server' : 'Running on your gateway'} data-stage={task.target.kind}>
      <header class="stage__head">
        {program && (
          <span class="stage__icon">
            <Icon name={programIcon(program.kind)} size={18} />
          </span>
        )}
        <strong class="stage__name">{program?.name ?? task.programId}</strong>
        <span class="stage__what">{describeTarget(task.target)}</span>
        <Bar taskId={task.id} />
        <TimeLeft taskId={task.id} />
        <button type="button" class="btn btn--small" data-tip="Stop this program. Its progress is lost." onClick={() => session.dispatch({ type: 'cancelProgram', taskId: task.id })}>
          Stop
        </button>
      </header>
      <div key={task.id} class="stage__body">
        {showFor(game, task)}
      </div>
      {others.length > 0 && (
        <div class="stage__others">
          <span class="stage__also">Also running</span>
          {others.map((other) => (
            <button
              key={other.id}
              type="button"
              class={`stage__chip${handsOnOpen(other) ? ' has-play' : ''}`}
              data-tip="Bring this program to the front"
              onClick={() => {
                front.current = other.id;
                redraw((n) => n + 1);
              }}
            >
              {describeTarget(other.target)}
              <Bar taskId={other.id} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
