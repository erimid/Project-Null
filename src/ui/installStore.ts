/**
 * Installing the game as an app, and playing it offline. The service worker
 * (written by tools/offline.mjs at build time) keeps the game's own files;
 * the browser offers installing when it is ready to, and the game menu
 * shows the offer.
 */
import { useEffect, useState } from 'preact/hooks';

/** The browser's offer to install, held until the player takes it. Not in every browser's types. */
interface InstallOffer extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** The browser will install the game if asked. */
  readonly offered: boolean;
  /** Running as an installed app. */
  readonly installed: boolean;
  /** The game's files are kept for playing offline. */
  readonly offline: boolean;
}

let offer: InstallOffer | null = null;
let state: InstallState = { offered: false, installed: false, offline: false };
const listeners = new Set<() => void>();

function set(next: Partial<InstallState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const install = {
  /** Registers the offline worker (in the built game only) and listens for the browser's install offer. */
  start(): void {
    const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
    set({ installed: standalone });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      offer = event as InstallOffer;
      set({ offered: true });
    });
    window.addEventListener('appinstalled', () => {
      offer = null;
      set({ offered: false, installed: true });
    });
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .then(() => set({ offline: true }))
      .catch(() => undefined);
  },
  get: (): InstallState => state,
  /** Shows the browser's own install question. */
  async ask(): Promise<void> {
    if (!offer) return;
    const asked = offer;
    offer = null;
    set({ offered: false });
    await asked.prompt();
    const choice = await asked.userChoice;
    if (choice.outcome === 'accepted') set({ installed: true });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useInstall(): InstallState {
  const [now, setNow] = useState(state);
  useEffect(() => install.subscribe(() => setNow(state)), []);
  return now;
}
