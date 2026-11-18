import { useEffect, useState } from 'preact/hooks';
import { useHints } from './hintStore';

interface Tip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly below: boolean;
}

/** How long the pointer rests on something before its label shows. */
const DELAY_MS = 450;

/**
 * Short labels for the mouse: rest the pointer on anything with a data-tip
 * or a title (a window tab, a button, a readout, a security layer) and a
 * note on what it does appears next to it, sooner and easier to read than
 * the browser's own. Keyboard focus shows it too. Touch screens get these from
 * TouchTips instead, by pressing and holding.
 */
export function HoverTips() {
  const { on } = useHints();
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!on) {
      setTip(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    // An element whose title is held back while our label shows, so the browser's own plain one doesn't show as well.
    let quiet: { element: Element; title: string } | null = null;
    const unquiet = () => {
      if (quiet && !quiet.element.hasAttribute('title')) quiet.element.setAttribute('title', quiet.title);
      quiet = null;
    };
    const hide = () => {
      clearTimeout(timer);
      unquiet();
      current = null;
      setTip(null);
    };
    const showFor = (element: Element, wait: number) => {
      if (element === current) return;
      hide();
      current = element;
      const title = element.getAttribute('title');
      if (title) {
        quiet = { element, title };
        element.removeAttribute('title');
      }
      timer = setTimeout(() => {
        // A greyed-out button's title says why it can't be used, which matters more than what it does.
        const text = (element.matches(':disabled') && quiet?.title) || element.getAttribute('data-tip') || quiet?.title;
        if (!text || !element.isConnected) return;
        const box = element.getBoundingClientRect();
        // Above, unless that would leave the screen; the bottom bar's labels always go above.
        const below = box.top < 90;
        setTip({ text, x: box.left + box.width / 2, y: below ? box.bottom + 8 : box.top - 8, below });
      }, wait);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const element = (event.target as Element | null)?.closest?.('[data-tip], [title]');
      if (element) showFor(element, DELAY_MS);
      else if (current) hide();
    };
    const onFocus = (event: FocusEvent) => {
      const element = event.target as Element | null;
      if (element?.matches?.(':focus-visible') && (element.hasAttribute('data-tip') || element.hasAttribute('title'))) showFor(element, 0);
    };
    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('focusout', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('keydown', hide, true);
    return () => {
      hide();
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('keydown', hide, true);
    };
  }, [on]);

  if (!tip) return null;
  return (
    <div
      class={`hover-tip${tip.below ? ' hover-tip--below' : ''}`}
      role="tooltip"
      style={{ left: `clamp(140px, ${tip.x}px, calc(100vw - 140px))`, top: `${tip.y}px` }}
    >
      {tip.text}
    </div>
  );
}
