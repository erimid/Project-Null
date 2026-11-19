/**
 * Layers run from another server. While the player holds an
 * administrator login on the server a layer is run from, that layer is
 * out of action on the server it protects.
 */
import type { LinkLayer } from '../content/schema';
import type { Connection, GameState } from './state';
import { findServer, linkOf, type Content } from './world';

/**
 * The connection that is holding this server's layer open, if any: an
 * admin login on the server the layer is run from.
 */
export function heldBy(state: GameState, content: Content, serverId: string, layer: LinkLayer): Connection | undefined {
  const server = findServer(content, serverId);
  const link = server && linkOf(state, server);
  if (!link || link.layer !== layer) return undefined;
  return state.connections.find((connection) => connection.serverId === link.serverId && connection.role === 'admin');
}

/** True while the monitor at the far end of this connection is kept busy from elsewhere. */
export const monitorHeld = (state: GameState, content: Content, connection: Connection): boolean =>
  heldBy(state, content, connection.serverId, 'monitor') !== undefined;

/** Servers whose layer this connection is holding open right now. */
export function holding(state: GameState, content: Content, connection: Connection): { serverId: string; layer: LinkLayer }[] {
  if (connection.role !== 'admin') return [];
  return content.servers.flatMap((server) => {
    const link = linkOf(state, server);
    return link?.serverId === connection.serverId ? [{ serverId: server.id, layer: link.layer }] : [];
  });
}
