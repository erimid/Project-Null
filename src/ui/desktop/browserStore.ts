/**
 * A way for other windows to open a page in the browser: the route map
 * opens a Wire story about a server this way. The browser takes the
 * request when it is next drawn, so it works whether or not it is open.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

export const browserStore = {
  /** Asks the browser to show this page on the public web. */
  open(address: string): void {
    pending = address;
    listeners.forEach((listener) => listener());
  },
  /** The page asked for, if any. Taking it clears it. */
  take(): string | null {
    const address = pending;
    pending = null;
    return address;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
