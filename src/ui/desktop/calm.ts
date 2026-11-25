import { comfort } from './comfortStore';

/** True when the player, or their system, asks for no flashing, pulsing or shaking. */
export const reducedMotion = (): boolean =>
  comfort.get().calm || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
