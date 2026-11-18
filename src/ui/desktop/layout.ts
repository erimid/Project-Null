/**
 * Which layout the screen gets. A phone shows one window at a time, full
 * screen, with a dock of big tabs. A tablet (or any middling screen) keeps
 * the same dock but shows two windows side by side. Anything wider keeps
 * the floating desk. This follows the screen live, so turning a tablet or
 * resizing a browser switches between them.
 */
import { useEffect, useState } from 'preact/hooks';

export type Layout = 'phone' | 'tablet' | 'desk';

/** Narrower than this is a phone, in portrait or landscape. */
export const PHONE_MAX_WIDTH = 759;
/** A phone on its side is wide but short. */
export const PHONE_MAX_HEIGHT = 500;

/** From a phone's width up to here is a tablet: two windows side by side. */
export const TABLET_MAX_WIDTH = 1100;

const phoneQuery = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px), (max-height: ${PHONE_MAX_HEIGHT}px) and (pointer: coarse)`);
const tabletQuery = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`);

export const currentLayout = (): Layout => (phoneQuery.matches ? 'phone' : tabletQuery.matches ? 'tablet' : 'desk');

/**
 * Marks the page, so the stylesheet can use classes as well as media queries.
 * .is-phone means "narrow windows, reflowed" and is on for a tablet too,
 * because each of its two windows is about as wide as a phone.
 */
function mark(): void {
  const layout = currentLayout();
  document.documentElement.classList.toggle('is-phone', layout !== 'desk');
  document.documentElement.classList.toggle('is-tablet', layout === 'tablet');
}
mark();
phoneQuery.addEventListener('change', mark);
tabletQuery.addEventListener('change', mark);

export function useLayout(): Layout {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const update = () => setLayout(currentLayout());
    update();
    phoneQuery.addEventListener('change', update);
    tabletQuery.addEventListener('change', update);
    return () => {
      phoneQuery.removeEventListener('change', update);
      tabletQuery.removeEventListener('change', update);
    };
  }, []);
  return layout;
}
