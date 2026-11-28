import { useEffect, useRef, useState } from 'preact/hooks';
import { sound, useSound } from '../audio';
import { EffectsLevel, SoundTest } from '../SoundDesk';
import { DIFFICULTIES, MODES } from '../../core';
import { useGame } from '../hooks';
import { session } from '../session';
import { deskLayout, useDeskLayout } from './deskLayout';
import { hintStore, useHints } from './hintStore';
import { useLayout } from './layout';
import { snapping, useSnapping } from './snapStore';
import { windows } from './windowStore';
import { look, useLook } from './lookStore';
import { recordStore, useRecordStore } from './recordStore';
import { comfort, TEXT_SIZES, useComfort } from './comfortStore';
import { install, useInstall } from '../installStore';
import { front } from '../title/front';

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['Space', 'Pause or resume'],
  ['1  2  3', 'Speed 1×, 2×, 4×'],
  ['Shift + Esc', 'Drop every connection'],
  ['Double-click title', 'Fill the screen, or put it back'],
];

/** The game menu: opens from the player's handle at the left of the bottom bar. */
export function GameMenu() {
  const handle = useGame((game) => game.player.handle);
  const difficulty = useGame((game) => game.difficulty);
  const [open, setOpen] = useState(false);
  const soundSettings = useSound();
  const hints = useHints();
  const snap = useSnapping();
  const layout = useDeskLayout();
  const desk = useLayout() === 'desk';
  const lookNow = useLook();
  const kept = useRecordStore();
  const ease = useComfort();
  const app = useInstall();
  const root = useRef<HTMLDivElement>(null);

  // Clicking anywhere else, or Esc, closes it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.shiftKey) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="menu" ref={root} data-tour="menu">
      <button
        type="button"
        class={`menu__button${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : 'Game menu: save and load, sound, keys, help'}
        onClick={() => setOpen(!open)}
      >
        <span class="menu__bars" aria-hidden="true" />
        <span class="menu__handle">{handle}</span>
        <span class="visually-hidden">Game menu</span>
      </button>
      {open && (
        <div class="menu__panel" role="menu">
          <button
            type="button"
            class="menu__item"
            role="menuitem"
            onClick={() => {
              windows.focus('saves');
              setOpen(false);
            }}
          >
            Saved games
            <span class="menu__item-note">Save, load, new game</span>
          </button>
          {app.offered && (
            <button
              type="button"
              class="menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void install.ask();
              }}
            >
              Install the game
              <span class="menu__item-note">Its own window and icon, and it plays with no connection</span>
            </button>
          )}
          <button
            type="button"
            class="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              hintStore.startTour();
            }}
          >
            Tour of the desk
            <span class="menu__item-note">What everything on screen is for</span>
          </button>
          <button
            type="button"
            class="menu__item"
            role="menuitem"
            data-menu="title"
            onClick={() => {
              setOpen(false);
              front.toTitle();
            }}
          >
            Title screen
            <span class="menu__item-note">Saves the game and leaves the desk</span>
          </button>
          <h3 class="menu__heading">Difficulty</h3>
          <div class="menu__sound">
            <span class="menu__choices" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map((id) => (
                <button
                  key={id}
                  type="button"
                  class={`btn${difficulty === id ? ' btn--go' : ''}`}
                  aria-pressed={difficulty === id}
                  data-difficulty={id}
                  onClick={() => session.dispatch({ type: 'setDifficulty', difficulty: id })}
                >
                  {MODES[id].name}
                </button>
              ))}
            </span>
          </div>
          <p class="menu__item-note menu__item-note--below">{MODES[difficulty].blurb} Change it whenever you like: nothing is lost.</p>
          <h3 class="menu__heading">Look</h3>
          <div class="menu__sound">
            <button type="button" class={`btn${lookNow.bar ? ' btn--go' : ''}`} aria-pressed={lookNow.bar} onClick={() => look.setBar(!lookNow.bar)}>
              {lookNow.bar ? 'On' : 'Off'}
            </button>
            <span class="menu__item-note">The test bar at the top of the screen: swap desk designs and colour themes with one press</span>
          </div>
          <h3 class="menu__heading">Text size</h3>
          <div class="menu__sound">
            <span class="menu__choices" role="group" aria-label="Text size">
              {TEXT_SIZES.map(([id, label]) => (
                <button key={id} type="button" class={`btn${ease.text === id ? ' btn--go' : ''}`} aria-pressed={ease.text === id} onClick={() => comfort.setText(id)}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          <h3 class="menu__heading">Less flashing</h3>
          <div class="menu__sound">
            <button type="button" class={`btn${ease.calm ? ' btn--go' : ''}`} aria-pressed={ease.calm} onClick={() => comfort.setCalm(!ease.calm)}>
              {ease.calm ? 'On' : 'Off'}
            </button>
            <span class="menu__item-note">No pulsing warnings, blinking lights or shaking desk. Warnings stay lit instead.</span>
          </div>
          <h3 class="menu__heading">Alerts in a corner</h3>
          <div class="menu__sound">
            <button type="button" class={`btn${ease.corner ? ' btn--go' : ''}`} aria-pressed={ease.corner} onClick={() => comfort.setCorner(!ease.corner)}>
              {ease.corner ? 'On' : 'Off'}
            </button>
            <span class="menu__item-note">Alerts drop into the top right corner instead of the middle of the screen</span>
          </div>
          <h3 class="menu__heading">Hints</h3>
          <div class="menu__sound">
            <button
              type="button"
              class={`btn${hints.on ? ' btn--go' : ''}`}
              aria-pressed={hints.on}
              onClick={() => hintStore.setOn(!hints.on)}
            >
              {hints.on ? 'On' : 'Off'}
            </button>
            <span class="menu__item-note">Labels on hover, and a help card the first time each window opens</span>
          </div>
          <h3 class="menu__heading">Job reports</h3>
          <div class="menu__sound">
            <button type="button" class={`btn${kept.reports ? ' btn--go' : ''}`} aria-pressed={kept.reports} onClick={() => recordStore.showReports(!kept.reports)}>
              {kept.reports ? 'On' : 'Off'}
            </button>
            <span class="menu__item-note">A card after each job: pay, time inside, the closest trace, what was left in the logs</span>
          </div>
          {desk && (
            <>
              <h3 class="menu__heading">Desk layouts</h3>
              <div class="menu__sound">
                <button
                  type="button"
                  class={`btn${layout.auto ? ' btn--go' : ''}`}
                  aria-pressed={layout.auto}
                  onClick={() => deskLayout.setAuto(!layout.auto)}
                >
                  {layout.auto ? 'On' : 'Off'}
                </button>
                <span class="menu__item-note">Switch to Run by itself when you connect, and back when you disconnect. Plan, Run and Home are on the bar either way.</span>
              </div>
              <h3 class="menu__heading">Window snapping</h3>
              <div class="menu__sound">
                <button
                  type="button"
                  class={`btn${snap.on ? ' btn--go' : ''}`}
                  aria-pressed={snap.on}
                  onClick={() => snapping.setOn(!snap.on)}
                >
                  {snap.on ? 'On' : 'Off'}
                </button>
                <span class="menu__item-note">Edges stick together. Drag to a side for half the screen, a corner for a quarter, or on a wide screen the bottom edge for a third. Hold Shift to drag freely.</span>
              </div>
            </>
          )}
          <h3 class="menu__heading">Sound</h3>
          <div class="menu__sound">
            <button
              type="button"
              class={`btn${soundSettings.on ? ' btn--go' : ''}`}
              aria-pressed={soundSettings.on}
              onClick={() => sound.set({ on: !soundSettings.on })}
            >
              {soundSettings.on ? 'On' : 'Off'}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              aria-label="Volume"
              value={Math.round(soundSettings.volume * 100)}
              disabled={!soundSettings.on}
              onInput={(event) => sound.set({ volume: Number((event.currentTarget as HTMLInputElement).value) / 100 })}
            />
          </div>
          <h3 class="menu__heading">Music</h3>
          <div class="menu__sound">
            <button
              type="button"
              class={`btn${soundSettings.music ? ' btn--go' : ''}`}
              aria-pressed={soundSettings.music}
              disabled={!soundSettings.on}
              data-tip="The soundtrack: a quiet bed at rest, a pulse while connected, a climb under a trace"
              onClick={() => sound.set({ music: !soundSettings.music })}
            >
              {soundSettings.music ? 'On' : 'Off'}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              aria-label="Music volume"
              value={Math.round(soundSettings.musicVolume * 100)}
              disabled={!soundSettings.on || !soundSettings.music}
              onInput={(event) => sound.set({ musicVolume: Number((event.currentTarget as HTMLInputElement).value) / 100 })}
            />
          </div>
          <EffectsLevel />
          <SoundTest />
          <h3 class="menu__heading">Keys</h3>
          <dl class="menu__keys">
            {SHORTCUTS.map(([keys, what]) => (
              <>
                <dt class="data">{keys}</dt>
                <dd>{what}</dd>
              </>
            ))}
          </dl>
          <p class="menu__build data">
            build {__APP_VERSION__} · {__APP_COMMIT__}
            {app.offline && ' · plays offline'}
          </p>
        </div>
      )}
    </div>
  );
}
