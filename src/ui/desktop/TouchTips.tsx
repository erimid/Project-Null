import { useEffect, useState } from 'preact/hooks';

interface Tip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly below: boolean;
}

const SHOW_MS = 3500;
/** How long a finger rests on something before its label shows instead of it being pressed. */
const HOLD_MS = 480;
/** A finger that moves further than this is scrolling, not holding. */
const SLOP_PX = 10;

const textOf = (element: Element | null | undefined) => element?.getAttribute('data-tip') || element?.getAttribute('title') || '';

/**
 * On a touch screen there is no hover, so the explanations kept in title
 * and data-tip attributes would never be seen. A tap on something that
 * has one and does nothing else (a greyed-out button, a blocked port, a
 * readout) shows it in a small bubble. Buttons that do something when
 * tapped just do it; press and hold one instead to read its label without
 * pressing it.
 */
export function TouchTips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    // Set when a hold showed a label: the tap that ends it must not press the button.
    let swallow = false;

    const show = (element: Element, text: string) => {
      const box = element.getBoundingClientRect();
      const below = box.top < 120;
      setTip({ text, x: box.left + box.width / 2, y: below ? box.bottom + 8 : box.top - 8, below });
      clearTimeout(timer);
      timer = setTimeout(() => setTip(null), SHOW_MS);
    };

    // A disabled button can't be tapped through to, so look under the finger for one.
    const disabledAt = (x: number, y: number) =>
      [...document.querySelectorAll<HTMLElement>('button[disabled][title], button[disabled][data-tip]')].find((button) => {
        const box = button.getBoundingClientRect();
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      });

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      swallow = false;
      start = { x: event.clientX, y: event.clientY };
      const target = event.target as Element | null;
      const labelled = target?.closest?.('[data-tip], [title]');
      const text = textOf(labelled);
      clearTimeout(hold);
      if (!labelled || !text) return;
      hold = setTimeout(() => {
        swallow = true;
        navigator.vibrate?.(8);
        show(labelled, text);
      }, HOLD_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) clearTimeout(hold);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      clearTimeout(hold);
      start = null;
      if (swallow) return;
      const target = event.target as Element | null;
      const labelled = target?.closest?.('[data-tip], [title]') ?? disabledAt(event.clientX, event.clientY);
      const text = textOf(labelled);
      const live = labelled?.closest('button, [role="button"], a, input, select');
      if (!labelled || !text || (live && !(live as HTMLButtonElement).disabled && live !== labelled.closest('.alarm__main'))) {
        setTip(null);
        return;
      }
      show(labelled, text);
    };
    const onClick = (event: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onCancel = () => {
      clearTimeout(hold);
      start = null;
    };
    // A long press would otherwise open the browser's own menu or start selecting text.
    const onMenu = (event: Event) => {
      if (swallow) event.preventDefault();
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onMenu, true);
      clearTimeout(timer);
      clearTimeout(hold);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      class={`touch-tip${tip.below ? ' touch-tip--below' : ''}`}
      role="status"
      style={{ left: `clamp(12px, ${tip.x}px - 140px, calc(100vw - 292px))`, top: `${tip.y}px` }}
    >
      {tip.text}
    </div>
  );
}
