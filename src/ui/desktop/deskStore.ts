/**
 * Small pieces of screen state shared between windows: which server is
 * selected on the map, which connection's tab is in front, and which
 * section of a server is being looked at. Not saved.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Connection, GameState } from '../../core';

export const SECTIONS = ['files', 'logs', 'records', 'directory'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Desk {
  /** Server picked on the route map, if any. */
  readonly selectedServerId: string | null;
  /** Connection whose tab is in front. */
  readonly activeConnectionId: string | null;
  /** Section being viewed, per connection id. */
  readonly sections: Readonly<Record<string, Section>>;
}

let desk: Desk = { selectedServerId: null, activeConnectionId: null, sections: {} };
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
