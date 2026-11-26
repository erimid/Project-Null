import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DIFFICULTIES, MODES, caseFile, handleAt, type Difficulty } from '../../core';
import { endings, gameInfo, ladder, rivals } from '../../content';
import { sound, useSound } from '../audio';
import { formatMoney, formatRating, formatSavedAt } from '../format';
import { useSaveStatus, useWorld } from '../hooks';
import { SLOT_COUNT, content, session } from '../session';
import { ConfirmButton } from '../desktop/ConfirmButton';
import { reducedMotion } from '../desktop/calm';
import { comfort, TEXT_SIZES, useComfort } from '../desktop/comfortStore';
import { useRecordStore } from '../desktop/recordStore';
import { uiSound } from '../sfx';
import { front, useFront, type Panel } from './front';
import { TitleGlobe } from './TitleGlobe';
import { CREDITS } from './words';
import './title.css';

/** The game's name. Its last word keeps only its first letter until this career has read the whole of it. */
export function Wordmark({ known }: { known: boolean }) {
  const words = gameInfo.title.toUpperCase().split(' ');
  const last = words.pop() ?? '';
  return (
    <h1 class="title__name" aria-label={known ? gameInfo.title : `${words.join(' ')} ${last[0]}, the rest blocked out`}>
      <span class="title__word">{words.join(' ')}</span>{' '}
      <span class="title__word title__word--last">
        {known
          ? last
          : [...last].map((letter, index) => (index === 0 ? letter : <i key={index} class="title__block" />))}
      </span>
    </h1>
  );
}

/** One mark per ending, lit once any career in this browser has reached it. */
function EndingMarks() {
  const seen = useRecordStore().endings;
  const count = endings.filter((ending) => seen.includes(ending.id)).length;
  return (
    <p class="title__endings" aria-label={`Endings seen: ${count} of ${endings.length}`}>
      {endings.map((ending) => {
        const lit = seen.includes(ending.id);
        return <span key={ending.id} class={`title__mark${lit ? ' is-lit' : ''}`} title={lit ? ending.name : 'An ending not yet seen'} />;
      })}
      <span class="title__endings-note">
        {count === 0 ? 'No ending seen yet' : `${count} of ${endings.length} endings seen`}
      </span>
    </p>
  );
}

function Sheet({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="title__sheet" aria-label={title}>
      <header class="title__sheet-head">
        <h2>{title}</h2>
        <button type="button" class="btn" data-title="back" onClick={() => front.show('menu')}>
          Back
        </button>
      </header>
      {children}
    </section>
  );
}

function Menu() {
  const status = useSaveStatus();
  const who = useWorld((game) => `${game.player.handle} · ${formatRating(game.player.rating)}`);
  const saved = status.slots.some((slot) => slot !== null);
  const items: readonly (readonly [Panel | 'continue', string, string, boolean])[] = [
    ['continue', 'Continue', `${who} · slot ${status.activeSlot}`, status.begun],
    ['new', 'New game', 'Pick a handle, a difficulty and a world', true],
    ['load', 'Load', saved ? 'Another saved career, or a backup file' : 'A backup file', true],
    ['settings', 'Settings', 'Text size, flashing, sound', true],
    ['credits', 'Credits', '', true],
  ];
  return (
    <nav class="title__menu" aria-label="Title menu">
      {items.filter(([, , , shown]) => shown).map(([id, label, note]) => (
        <button
          key={id}
          type="button"
          class={`title__item${id === (status.begun ? 'continue' : 'new') ? ' is-first' : ''}`}
          data-title={id}
          onClick={() => {
            uiSound('pick');
            if (id === 'continue') front.play();
            else front.show(id);
          }}
        >
          <span class="title__item-label">{label}</span>
          {note && <span class="title__item-note">{note}</span>}
        </button>
      ))}
    </nav>
  );
}

const TAKEN: readonly string[] = [...rivals.map((rival) => rival.handle), ...ladder.rivals.map((rival) => rival.handle)];
const WORLD_DIGITS = 4;
const randomInt = (below: number) => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % below;
const randomWorld = () => Array.from({ length: WORLD_DIGITS }, () => randomInt(10));

function NewGame() {
  const status = useSaveStatus();
  const asked = useFront().slot;
  const [seed] = useState(() => randomInt(0xffffffff));
  const [index, setIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [digits, setDigits] = useState(randomWorld);
  const firstEmpty = status.slots.findIndex((slot) => slot === null) + 1;
  const [slot, setSlot] = useState(asked ?? (firstEmpty || status.activeSlot));
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  const handle = handleAt(seed, index, TAKEN);
  const spin = () => {
    if (spinning) return;
    if (reducedMotion()) return setIndex((now) => now + 1);
    // A few names flick past before it settles on the next one.
    let left = 7;
    setSpinning(true);
    timer.current = setInterval(() => {
      left--;
      setIndex((now) => now + 1);
      uiSound('pick');
      if (left <= 0) {
        clearInterval(timer.current);
        setSpinning(false);
      }
    }, 70);
  };
  const turn = (place: number, by: number) => setDigits((now) => now.map((digit, at) => (at === place ? (digit + by + 10) % 10 : digit)));
  const world = Number(digits.join(''));
  const taken = status.slots[slot - 1] ?? null;
  const begin = () => {
    setFailed(false);
    void front.begin({ slot, handle, difficulty, world }).then((ok) => setFailed(!ok));
  };

  return (
    <Sheet title="New game">
      <div class="newgame">
        <section class="newgame__part" aria-label="Handle">
          <h3 class="title__label">Handle</h3>
          <p class={`newgame__handle data${spinning ? ' is-spinning' : ''}`} data-title="handle" aria-live="polite">
            {handle}
          </p>
          <div class="newgame__row">
            <button type="button" class="btn btn--go" data-title="spin" disabled={spinning} onClick={spin}>
              Spin
            </button>
            <button type="button" class="btn" disabled={spinning || index === 0} onClick={() => setIndex((now) => Math.max(0, now - 1))}>
              Back one
            </button>
          </div>
          <p class="title__note">What the boards will call you. Spin until one fits.</p>
        </section>

        <section class="newgame__part" aria-label="Difficulty">
          <h3 class="title__label">Difficulty</h3>
          <div class="newgame__row" role="group" aria-label="Difficulty">
            {DIFFICULTIES.map((id) => (
              <button key={id} type="button" class={`btn${difficulty === id ? ' btn--go' : ''}`} aria-pressed={difficulty === id} data-difficulty={id} onClick={() => setDifficulty(id)}>
                {MODES[id].name}
              </button>
            ))}
          </div>
          <p class="title__note">{MODES[difficulty].blurb} It can be changed later from the game menu.</p>
        </section>

        <section class="newgame__part" aria-label="World number">
          <h3 class="title__label">World number</h3>
          <div class="newgame__world">
            {digits.map((digit, place) => (
              <span key={place} class="newgame__digit">
                <button type="button" class="newgame__step" aria-label={`Digit ${place + 1} up`} onClick={() => turn(place, 1)}>
                  ▲
                </button>
                <span class="data" data-title="digit">
                  {digit}
                </span>
                <button type="button" class="newgame__step" aria-label={`Digit ${place + 1} down`} onClick={() => turn(place, -1)}>
                  ▼
                </button>
              </span>
            ))}
            <button type="button" class="btn" onClick={() => setDigits(randomWorld())}>
              Shuffle
            </button>
          </div>
          <p class="title__note">Each number builds its own set of companies. Two people who pick the same number play the same world.</p>
        </section>

        <section class="newgame__part" aria-label="Save slot">
          <h3 class="title__label">Saved in</h3>
          <div class="newgame__row" role="group" aria-label="Save slot">
            {Array.from({ length: SLOT_COUNT }, (_, at) => {
              const save = status.slots[at] ?? null;
              return (
                <button key={at} type="button" class={`btn newgame__slot${slot === at + 1 ? ' btn--go' : ''}`} aria-pressed={slot === at + 1} onClick={() => setSlot(at + 1)}>
                  Slot {at + 1}
                  <span class="newgame__slot-note">{save ? save.handle : 'empty'}</span>
                </button>
              );
            })}
          </div>
          {taken && <p class="title__note title__note--warn">Slot {slot} holds {taken.handle}'s career. Starting here erases it.</p>}
        </section>
      </div>
      <footer class="title__sheet-foot">
        {failed && <span class="title__note title__note--warn">{status.notice}</span>}
        {taken ? (
          <ConfirmButton class="btn btn--danger title__begin" confirmLabel={`Erase ${taken.handle}?`} onConfirm={begin}>
            Begin as {handle}
          </ConfirmButton>
        ) : (
          <button type="button" class="btn btn--go title__begin" data-title="begin" disabled={spinning} onClick={begin}>
            Begin as {handle}
          </button>
        )}
      </footer>
    </Sheet>
  );
}

function Load() {
  const status = useSaveStatus();
  const picker = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const firstEmpty = status.slots.findIndex((slot) => slot === null) + 1;
  const done = (ok: boolean) => {
    setFailed(!ok);
    if (ok) front.play();
  };
  const onFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && firstEmpty) done(await session.importInto(firstEmpty, await file.text()));
  };
  return (
    <Sheet title="Load">
      <ul class="title__slots">
        {Array.from({ length: SLOT_COUNT }, (_, at) => {
          const save = status.slots[at] ?? null;
          return (
            <li key={at} class="title__slot">
              <span class="title__slot-name">Slot {at + 1}</span>
              {save ? (
                <>
                  <span class="title__slot-who">
                    <strong class="data">{save.handle}</strong>
                    <span class="title__note">
                      {formatMoney(save.balance)} · saved {formatSavedAt(save.savedAt)}
                    </span>
                  </span>
                  <button type="button" class="btn btn--go" data-title={`load-${at + 1}`} onClick={() => void session.loadFrom(at + 1).then(done)}>
                    Load
                  </button>
                </>
              ) : (
                <span class="title__note">Empty</span>
              )}
            </li>
          );
        })}
      </ul>
      <footer class="title__sheet-foot">
        {failed && <span class="title__note title__note--warn">{status.notice}</span>}
        <span class="title__note">{firstEmpty ? `A backup file goes into slot ${firstEmpty}.` : 'Every slot is full. Delete one from Saved games to bring in a backup file.'}</span>
        <button type="button" class="btn" disabled={!firstEmpty} onClick={() => picker.current?.click()}>
          Load a backup file
        </button>
        <input ref={picker} class="visually-hidden" type="file" accept=".json,application/json" aria-label="Backup file to load" tabIndex={-1} onChange={onFile} />
      </footer>
    </Sheet>
  );
}

function Settings() {
  const ease = useComfort();
  const heard = useSound();
  return (
    <Sheet title="Settings">
      <div class="title__settings">
        <h3 class="title__label">Text size</h3>
        <div class="newgame__row" role="group" aria-label="Text size">
          {TEXT_SIZES.map(([id, label]) => (
            <button key={id} type="button" class={`btn${ease.text === id ? ' btn--go' : ''}`} aria-pressed={ease.text === id} onClick={() => comfort.setText(id)}>
              {label}
            </button>
          ))}
        </div>
        <h3 class="title__label">Less flashing</h3>
        <div class="newgame__row">
          <button type="button" class={`btn${ease.calm ? ' btn--go' : ''}`} aria-pressed={ease.calm} onClick={() => comfort.setCalm(!ease.calm)}>
            {ease.calm ? 'On' : 'Off'}
          </button>
          <span class="title__note">No pulsing warnings, blinking lights or shaking desk. The globe here stands still too.</span>
        </div>
        <h3 class="title__label">Sound</h3>
        <div class="newgame__row">
          <button type="button" class={`btn${heard.on ? ' btn--go' : ''}`} aria-pressed={heard.on} onClick={() => sound.set({ on: !heard.on })}>
            {heard.on ? 'On' : 'Off'}
          </button>
          <input type="range" min="0" max="100" aria-label="Volume" value={Math.round(heard.volume * 100)} disabled={!heard.on} onInput={(event) => sound.set({ volume: Number((event.currentTarget as HTMLInputElement).value) / 100 })} />
        </div>
        <h3 class="title__label">Music</h3>
        <div class="newgame__row">
          <button type="button" class={`btn${heard.music ? ' btn--go' : ''}`} aria-pressed={heard.music} disabled={!heard.on} onClick={() => sound.set({ music: !heard.music })}>
            {heard.music ? 'On' : 'Off'}
          </button>
          <input type="range" min="0" max="100" aria-label="Music volume" value={Math.round(heard.musicVolume * 100)} disabled={!heard.on || !heard.music} onInput={(event) => sound.set({ musicVolume: Number((event.currentTarget as HTMLInputElement).value) / 100 })} />
        </div>
        <p class="title__note">The rest (hints, job reports, the look of the desk) is in the game menu, at the desk.</p>
      </div>
    </Sheet>
  );
}

function Credits() {
  return (
    <Sheet title="Credits">
      <dl class="title__credits">
        {CREDITS.map(([role, lines]) => (
          <div key={role} class="title__credit">
            <dt class="title__label">{role}</dt>
            {lines.map((line) => (
              <dd key={line}>{line}</dd>
            ))}
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/** The front door: the name over the turning globe, and the way in. */
export function Title() {
  const { panel } = useFront();
  const status = useSaveStatus();
  // Only a career that has read the name sees all of it here.
  const known = useWorld((game) => status.begun && caseFile(game, content).name?.full === true);
  return (
    <div class={`title title--${panel}`}>
      <div class="title__sky">
        <TitleGlobe />
      </div>
      <div class="title__column">
        <header class="title__head">
          <Wordmark known={known} />
          <EndingMarks />
        </header>
        {panel === 'menu' && <Menu />}
        {panel === 'new' && <NewGame />}
        {panel === 'load' && <Load />}
        {panel === 'settings' && <Settings />}
        {panel === 'credits' && <Credits />}
      </div>
    </div>
  );
}
