import { useEffect, useRef, useState } from 'preact/hooks';
import { useGame } from '../hooks';
import { windows } from './windowStore';

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['Space', 'Pause or resume'],
  ['1  2  3', 'Speed 1×, 2×, 4×'],
  ['Shift + Esc', 'Drop every connection'],
];

/** The game menu: opens from the player's handle at the left of the bottom bar. */
export function GameMenu() {
  const handle = useGame((game) => game.player.handle);
  const [open, setOpen] = useState(false);
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
    <div class="menu" ref={root}>
      <button
        type="button"
        class={`menu__button${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
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
          </p>
        </div>
      )}
    </div>
  );
}
