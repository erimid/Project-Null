import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { effectiveSpeed, isConnected, type Speed } from '../../core';
import { session } from '../session';
import { tourChime } from '../sfx';
import { TOUCH_LAST_STEP, TOUR } from './help';
import { hintStore, useHints } from './hintStore';
import { useLayout } from './layout';
import { windows, type WindowId } from './windowStore';

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const PAD = 6;
const CARD_WIDTH = 340;

/** The windows the tour shows, so their help cards don't pop up again straight after. */
const COVERED: readonly WindowId[] = TOUR.flatMap((step) => (step.open ? [step.open] : []));

const touch = () => window.matchMedia('(pointer: coarse)').matches;

/** Where the thing a step points at is on screen, or null if it isn't showing. */
function find(target: string | undefined): Box | null {
  if (!target) return null;
  const element = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(
    (candidate) => candidate.offsetParent !== null || getComputedStyle(candidate).position === 'fixed',
  );
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  // Clipped to the screen, so a tall window still gets a sensible frame.
  const top = Math.max(box.top, 0);
  const bottom = Math.min(box.bottom, window.innerHeight);
  return { left: box.left - PAD, top: top - PAD, width: box.width + PAD * 2, height: bottom - top + PAD * 2 };
}

/** Where the card goes: beside the frame where there is room, else above or below it, else the middle. */
function cardPlace(box: Box | null, cardH: number): { left: number; top: number } | null {
  if (!box) return null;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cardW = Math.min(CARD_WIDTH, w - 24);
  const clampX = (x: number) => Math.min(Math.max(x, 12), w - cardW - 12);
  const clampY = (y: number) => Math.min(Math.max(y, 12), h - cardH - 12);
  if (box.top + box.height + cardH + 16 < h) return { left: clampX(box.left), top: box.top + box.height + 12 };
  if (box.top - cardH - 16 > 0) return { left: clampX(box.left), top: box.top - cardH - 12 };
  if (box.left + box.width + cardW + 16 < w) return { left: box.left + box.width + 12, top: clampY(box.top) };
  if (box.left - cardW - 16 > 0) return { left: box.left - cardW - 12, top: clampY(box.top) };
  return null;
}

/**
 * The tour of the desk: a dimmed screen with a lit frame around one part
 * of it at a time, and a card saying what that part is for. Offered once
 * to every new player, and again from the game menu.
 */
export function Tour() {
  const { step, toured } = useHints();
  const layout = useLayout();
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(200);
  // The clock stands still during the tour, and runs again at its old speed after.
  const resume = useRef<Speed | null>(null);
  const touring = step !== null;
  useEffect(() => {
    const game = session.getState();
    if (touring && !isConnected(game)) {
      resume.current = effectiveSpeed(game);
      session.dispatch({ type: 'setSpeed', speed: 0 });
    } else if (!touring && resume.current !== null) {
      if (!isConnected(game) && effectiveSpeed(game) === 0) session.dispatch({ type: 'setSpeed', speed: resume.current });
      resume.current = null;
    }
  }, [touring]);

  // Offered by itself the first time the game opens in this browser.
  useEffect(() => {
    if (!toured && step === null) hintStore.startTour();
  }, []);

  const current = step === null ? undefined : TOUR[step];

  // Bring the step's window up, then follow its frame as things move.
  useLayoutEffect(() => {
    if (!current) return;
    if (current.open) windows.focus(current.open);
    let frame = 0;
    const follow = () => {
      const next = find(current.target);
      setBox((last) =>
        last && next && last.left === next.left && last.top === next.top && last.width === next.width && last.height === next.height ? last : next,
      );
      const height = card.current?.offsetHeight;
      if (height) setCardH(height);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [step, layout]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.shiftKey) finish();
      else if (event.key === 'ArrowRight' || event.key === 'Enter') go(1);
      else if (event.key === 'ArrowLeft') go(-1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (step === null || !current) return null;

  const last = step === TOUR.length - 1;
  const finish = () => {
    hintStore.endTour(COVERED);
    // End on Wren's first message, which says where to start.
    windows.focus('messages');
  };
  function go(delta: number) {
    let next = step! + delta;
    // A phone has no desk layouts to point at.
    while (TOUR[next]?.deskOnly && layout !== 'desk') next += delta;
    if (next < 0) return;
    if (next >= TOUR.length) {
      finish();
      return;
    }
    tourChime();
    hintStore.goToStep(next);
  }

  const shownSteps = TOUR.filter((item) => layout === 'desk' || !item.deskOnly);
  const place = cardPlace(box, cardH);
  const body = last && touch() ? TOUCH_LAST_STEP : current.body;

  return (
    <div class="tour" role="dialog" aria-modal="true" aria-label="Tour of the desk">
      {box ? (
        <div
          class="tour__frame"
          style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}
          aria-hidden="true"
        />
      ) : (
        <div class="tour__shade" aria-hidden="true" />
      )}
      <div
        key={step}
        ref={card}
        class={`tour__card${place ? '' : ' tour__card--middle'}`}
        style={place ? { left: `${place.left}px`, top: `${place.top}px` } : undefined}
      >
        <p class="tour__count data">
          {shownSteps.indexOf(current) + 1} / {shownSteps.length}
        </p>
        <h2 class="tour__title">{current.title}</h2>
        <p class="tour__body">{body}</p>
        <div class="tour__actions">
          {!last && (
            <button type="button" class="tour__skip" onClick={finish}>
              {step === 0 ? 'Skip the tour' : 'End tour'}
            </button>
          )}
          <span class="window__title-gap" />
          {step > 0 && (
            <button type="button" class="btn" onClick={() => go(-1)}>
              Back
            </button>
          )}
          <button type="button" class="btn btn--go" onClick={() => go(1)}>
            {step === 0 ? 'Show me' : last ? 'Start playing' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
