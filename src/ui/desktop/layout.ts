/**
 * Which layout the screen gets. A phone shows one window at a time, full
 * screen, with a dock of big tabs; anything wider keeps the floating desk.
 * This follows the screen live, so turning a tablet or resizing a browser
 * switches between them.
 */
import { useEffect, useState } from 'preact/hooks';

export type Layout = 'phone' | 'desk';

/** Narrower than this is a phone, in portrait or landscape. */
export const PHONE_MAX_WIDTH = 759;
/** A phone on its side is wide but short. */
export const PHONE_MAX_HEIGHT = 500;

const query = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px), (max-height: ${PHONE_MAX_HEIGHT}px) and (pointer: coarse)`);

export const currentLayout = (): Layout => (query.matches ? 'phone' : 'desk');

/** Marks the page, so the stylesheet can use .is-phone as well as media queries. */
function mark(): void {
  document.documentElement.classList.toggle('is-phone', query.matches);
}
mark();
query.addEventListener('change', mark);

export function useLayout(): Layout {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const update = () => setLayout(currentLayout());
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return layout;
}
