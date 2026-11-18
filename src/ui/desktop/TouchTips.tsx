import { useEffect, useState } from 'preact/hooks';

interface Tip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly below: boolean;
}

const SHOW_MS = 3500;

/**
 * On a touch screen there is no hover, so the explanations kept in title
 * attributes would never be seen. A tap on something that has one (a
 * greyed-out button, a blocked port, a sealed file) shows it in a small
 * bubble instead. Buttons that do something when tapped just do it.
 */
export function TouchTips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTap = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const target = event.target as Element | null;
      // A disabled button can't be tapped through to, so look under the finger for one.
      const titled =
        target?.closest?.('[title]') ??
        [...document.querySelectorAll<HTMLElement>('button[disabled][title]')].find((button) => {
          const box = button.getBoundingClientRect();
          return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        });
      const text = titled?.getAttribute('title');
      const live = titled?.closest('button, [role="button"], a, input, select');
      if (!titled || !text || (live && !(live as HTMLButtonElement).disabled && live !== titled.closest('.alarm__main'))) {
        setTip(null);
        return;
      }
      const box = titled.getBoundingClientRect();
      const below = box.top < 120;
      setTip({ text, x: box.left + box.width / 2, y: below ? box.bottom + 8 : box.top - 8, below });
      clearTimeout(timer);
      timer = setTimeout(() => setTip(null), SHOW_MS);
    };
    document.addEventListener('pointerup', onTap, true);
    return () => {
      document.removeEventListener('pointerup', onTap, true);
      clearTimeout(timer);
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
