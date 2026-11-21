/**
 * Small pieces of screen state shared between windows: which server is
 * selected on the map, which connection's tab is in front, which section
 * of a server is being looked at, whether the contract is dropped down
 * from the top bar, and which side of Programs is showing. Not saved.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Connection, GameState } from '../../core';

export const SECTIONS = ['contracts', 'ladder', 'market', 'hardware', 'files', 'logs', 'records', 'directory'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Desk {
  /** Server picked on the route map, if any. */
  readonly selectedServerId: string | null;
  /** Connection whose tab is in front. */
  readonly activeConnectionId: string | null;
  /** Section being viewed, per connection id. */
  readonly sections: Readonly<Record<string, Section>>;
  /** The contract's goal and steps are dropped down from the top bar. */
  readonly contractOpen: boolean;
  /** Which side of the Programs window is showing. */
  readonly programsTab: ProgramsTab;
}

export type ProgramsTab = 'programs' | 'workbench';

let desk: Desk = { selectedServerId: null, activeConnectionId: null, sections: {}, contractOpen: false, programsTab: 'programs' };
const listeners = new Set<() => void>();

function set(patch: Partial<Desk>): void {
  desk = { ...desk, ...patch };
  listeners.forEach((listener) => listener());
}

export const deskStore = {
  get: (): Desk => desk,
  select: (serverId: string | null) => set({ selectedServerId: serverId }),
  activate: (connectionId: string | null) => set({ activeConnectionId: connectionId }),
  showSection: (connectionId: string, section: Section) =>
    set({ sections: { ...desk.sections, [connectionId]: section } }),
  showContract: (open: boolean) => desk.contractOpen !== open && set({ contractOpen: open }),
  showPrograms: (tab: ProgramsTab) => desk.programsTab !== tab && set({ programsTab: tab }),
};

export function useDesk(): Desk {
  const [value, setValue] = useState(desk);
  useEffect(() => {
    const update = () => setValue(desk);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}

/** The connection whose tab is in front, or the first one if that tab is gone. */
export function activeConnection(game: GameState, current: Desk): Connection | undefined {
  return game.connections.find((c) => c.id === current.activeConnectionId) ?? game.connections[0];
}
