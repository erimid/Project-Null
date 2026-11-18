/**
 * The running game, as the UI sees it.
 *
 * This is the only place that connects the simulation (core/), the data
 * files (content/) and the browser (timers, storage, downloads). Screens
 * read from it with the hooks in hooks.ts and call its functions; they
 * never change the game state themselves.
 */
import {
  applyAction,
  createGame,
  deserializeGame,
  readSummary,
  serializeGame,
  syncWithContent,
  tick,
  type Action,
  type ActionResult,
  type Content,
  type GameState,
  type SaveSummary,
} from '../core';
import { gameInfo, servers, tuning } from '../content';
import { createMemoryStore, openSaveStore, type SaveStore } from './storage/saveStore';

/** The data files, in the form the simulation takes them. */
export const content: Content = { servers, startingServers: gameInfo.startingServers };

export const SLOT_COUNT = 3;
const ACTIVE_SLOT_KEY = 'active-slot';
const slotKey = (slot: number) => `slot-${slot}`;

/**
 * Browser storage (IndexedDB) can't be relied on to finish a write while
 * the page is closing or reloading. So on the way out the game is also
 * written here, to localStorage, which is immediate. The next start
 * picks it up if it is newer than the slot.
 */
const EXIT_SAVE_KEY = 'project-null.exit-save.v1';

function writeExitSave(): void {
  try {
    const text = serializeGame(state, new Date().toISOString());
    localStorage.setItem(EXIT_SAVE_KEY, JSON.stringify({ slot: saveStatus.activeSlot, text }));
  } catch {
    // Storage blocked or full: the regular autosave still applies.
  }
}

/** The exit save for this slot, if there is one and it is newer than `slotText`. */
function takeExitSave(slot: number, slotText: string | null): string | null {
  try {
    const raw = localStorage.getItem(EXIT_SAVE_KEY);
    localStorage.removeItem(EXIT_SAVE_KEY);
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (typeof saved !== 'object' || saved === null) return null;
    const { slot: savedSlot, text } = saved as { slot?: unknown; text?: unknown };
    if (savedSlot !== slot || typeof text !== 'string') return null;
    const exit = readSummary(text);
    if (!exit) return null;
    const current = slotText === null ? null : readSummary(slotText);
    return !current || Date.parse(exit.savedAt) > Date.parse(current.savedAt) ? text : null;
  } catch {
    return null;
  }
}

/** Everything about saving that screens show. Replaced (not edited) on every change. */
export interface SaveStatus {
  /** One entry per slot; null = empty. Index 0 is slot 1. */
  readonly slots: readonly (SaveSummary | null)[];
  /** The slot the game autosaves into (1-based). */
  readonly activeSlot: number;
  /** False when saves won't survive closing the tab. */
  readonly persistent: boolean;
  /** Last thing that happened, e.g. "Saved to slot 2". */
  readonly notice: string;
  /** True when `notice` reports a failure. */
  readonly noticeIsError: boolean;
}

type Listener = () => void;

let state: GameState;
let store: SaveStore = createMemoryStore();
let saveStatus: SaveStatus = {
  slots: Array.from({ length: SLOT_COUNT }, () => null),
  activeSlot: 1,
  persistent: false,
  notice: '',
  noticeIsError: false,
};

/** Told about every change, including each tick of the clock. */
const gameListeners = new Set<Listener>();
/** Told only when the player does something or a game is loaded, not on clock ticks. */
const changeListeners = new Set<Listener>();
let revision = 0;

function changed(): void {
  revision++;
  emit(changeListeners);
  emit(gameListeners);
}

const saveListeners = new Set<Listener>();
const emit = (listeners: Set<Listener>) => listeners.forEach((listener) => listener());

function setSaveStatus(patch: Partial<SaveStatus>): void {
  saveStatus = { ...saveStatus, ...patch };
  emit(saveListeners);
}

function report(notice: string, noticeIsError = false): void {
  setSaveStatus({ notice, noticeIsError });
}

function freshGame(): GameState {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  return syncWithContent(
    createGame({
      seed,
      handle: gameInfo.defaultHandle,
      startDate: tuning.startDate,
      startingBalance: tuning.startingBalance,
    }),
    content,
  );
}

/** Reads save text into a game that matches the current data files. */
const loadGame = (text: string): GameState => syncWithContent(deserializeGame(text).state, content);

function replaceGame(next: GameState): void {
  state = next;
  changed();
}

async function refreshSlots(): Promise<void> {
  const slots = await Promise.all(
    Array.from({ length: SLOT_COUNT }, async (_, index) => {
      const text = await store.read(slotKey(index + 1));
      return text === null ? null : readSummary(text);
    }),
  );
  setSaveStatus({ slots });
}

async function writeSlot(slot: number): Promise<void> {
  await store.write(slotKey(slot), serializeGame(state, new Date().toISOString()));
  await store.write(ACTIVE_SLOT_KEY, String(slot));
  setSaveStatus({ activeSlot: slot });
  await refreshSlots();
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** Runs a save operation and reports the outcome in the save window. */
async function attempt(done: string, work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    report(done);
    return true;
  } catch (error) {
    report(message(error), true);
    return false;
  }
}

function autosave(): void {
  void writeSlot(saveStatus.activeSlot).catch((error) => report(`Autosave failed: ${message(error)}`, true));
}

function startLoop(): void {
  let last = performance.now();
  const frame = (now: number) => {
    // Cap the step so a tab that was in the background doesn't jump ahead.
    const elapsed = Math.min(now - last, 250);
    last = now;
    if (tick(state, elapsed, tuning) > 0) emit(gameListeners);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  setInterval(autosave, tuning.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave();
  });
  window.addEventListener('pagehide', () => {
    writeExitSave();
    autosave();
  });
}

export const session = {
  /** Loads the last game (or starts a new one) and starts the clock. Call once. */
  async start(): Promise<void> {
    store = await openSaveStore();
    const savedSlot = Number(await store.read(ACTIVE_SLOT_KEY));
    const activeSlot = savedSlot >= 1 && savedSlot <= SLOT_COUNT ? savedSlot : 1;
    setSaveStatus({ persistent: store.persistent, activeSlot });

    let text = await store.read(slotKey(activeSlot));
    const exitSave = takeExitSave(activeSlot, text);
    if (exitSave !== null) {
      text = exitSave;
      await store.write(slotKey(activeSlot), exitSave).catch(() => undefined);
    }
    let loaded: GameState | null = null;
    if (text !== null) {
      try {
        loaded = loadGame(text);
      } catch (error) {
        report(`Slot ${activeSlot} could not be loaded: ${message(error)}`, true);
      }
    }
    state = loaded ?? freshGame();
    await refreshSlots();
    // Only write a brand-new game if the slot is really empty, never over a save that failed to load.
    if (text === null) await writeSlot(activeSlot).catch(() => undefined);
    startLoop();
  },

  getState: (): GameState => state,
  subscribeGame(listener: Listener): () => void {
    gameListeners.add(listener);
    return () => gameListeners.delete(listener);
  },

  getSaveStatus: (): SaveStatus => saveStatus,
  subscribeSaves(listener: Listener): () => void {
    saveListeners.add(listener);
    return () => saveListeners.delete(listener);
  },

  /** A number that goes up whenever the player does something or a game is loaded. */
  getRevision: (): number => revision,
  subscribeChanges(listener: Listener): () => void {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  },

  dispatch(action: Action): ActionResult {
    const result = applyAction(state, action, content);
    if (result.ok) changed();
    return result;
  },

  /** Saves the current game into a slot and makes that the autosave slot. */
  saveTo: (slot: number) => attempt(`Saved to slot ${slot}.`, () => writeSlot(slot)),

  loadFrom: (slot: number) =>
    attempt(`Loaded slot ${slot}.`, async () => {
      const text = await store.read(slotKey(slot));
      if (text === null) throw new Error(`Slot ${slot} is empty.`);
      replaceGame(loadGame(text));
      await store.write(ACTIVE_SLOT_KEY, String(slot));
      setSaveStatus({ activeSlot: slot });
    }),

  newGameIn: (slot: number) =>
    attempt(`New game started in slot ${slot}.`, async () => {
      replaceGame(freshGame());
      await writeSlot(slot);
    }),

  deleteSlot: (slot: number) =>
    attempt(`Slot ${slot} deleted.`, async () => {
      await store.remove(slotKey(slot));
      await refreshSlots();
    }),

  /** The text of a slot, for downloading as a file. */
  async exportSlot(slot: number): Promise<string | null> {
    if (slot === saveStatus.activeSlot) await writeSlot(slot).catch(() => undefined);
    return store.read(slotKey(slot));
  },

  /** Puts a save file's text into a slot and loads it. */
  importInto: (slot: number, text: string) =>
    attempt(`Imported into slot ${slot}.`, async () => {
      replaceGame(loadGame(text));
      await writeSlot(slot);
    }),
};
