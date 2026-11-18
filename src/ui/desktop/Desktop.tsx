import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { useEffect, useRef } from 'preact/hooks';
import { mostUrgentTrace } from '../../core';
import { useGame } from '../hooks';
import type { Speed } from '../../core';
import { content, session } from '../session';
import { Alerts } from './Alerts';
import { BrowserWindow } from './windows/BrowserWindow';
import { ContractWindow } from './windows/ContractWindow';
import { GatewayWindow } from './windows/GatewayWindow';
import { MapWindow } from './windows/MapWindow';
import { MessagesWindow } from './windows/MessagesWindow';
import { ProgramsWindow } from './windows/ProgramsWindow';
import { ViewerWindow } from './windows/ViewerWindow';
import { SavesWindow } from './windows/SavesWindow';
import { ServerWindow } from './windows/ServerWindow';
import './desktop.css';

const SPEED_KEYS: Readonly<Record<string, Speed>> = { '1': 1, '2': 2, '3': 4 };

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  useEffect(() => {
    // The speed to go back to when Space ends a pause.
    let resumeSpeed: Speed = 1;
    const onKey = (event: KeyboardEvent) => {
      // The panic key: Shift+Esc drops every connection at once.
      if (event.key === 'Escape' && event.shiftKey) {
        event.preventDefault();
        session.dispatch({ type: 'disconnectAll' });
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const current = session.getState().clock.speed;
      if (event.key === ' ') {
        // Also stops Space from pressing whichever button was clicked last.
        event.preventDefault();
        if (current !== 0) resumeSpeed = current;
        session.dispatch({ type: 'setSpeed', speed: current === 0 ? resumeSpeed : 0 });
      } else if (event.key in SPEED_KEYS) {
        session.dispatch({ type: 'setSpeed', speed: SPEED_KEYS[event.key]! });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tracing = useGame((game) => mostUrgentTrace(game, content) !== undefined);
  // The whole desk jolts when a trace cuts the line.
  const desk = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      session.subscribeEvents((event) => {
        if (event.type !== 'disconnected' || !event.traced) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const shake = ['-7px, 3px', '6px, -4px', '-4px, 2px', '3px, -1px', '0, 0'];
        desk.current?.animate(
          shake.map((offset) => ({ transform: `translate(${offset})` })),
          { duration: 450 },
        );
      }),
    [],
  );

  return (
    <div ref={desk} class={`desktop${tracing ? ' is-tracing' : ''}`}>
      <TopBar />
      <main class="workspace">
        <GatewayWindow />
        <MapWindow />
        <ServerWindow />
        <ProgramsWindow />
        <MessagesWindow />
        <ContractWindow />
        <BrowserWindow net="web" />
        <BrowserWindow net="dark" />
        <ViewerWindow />
        <SavesWindow />
        <Alerts />
      </main>
      <BottomBar />
    </div>
  );
}
