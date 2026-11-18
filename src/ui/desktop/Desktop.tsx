import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { useEffect } from 'preact/hooks';
import { session } from '../session';
import { ContractWindow } from './windows/ContractWindow';
import { GatewayWindow } from './windows/GatewayWindow';
import { MapWindow } from './windows/MapWindow';
import { MessagesWindow } from './windows/MessagesWindow';
import { ProgramsWindow } from './windows/ProgramsWindow';
import { SavesWindow } from './windows/SavesWindow';
import { ServerWindow } from './windows/ServerWindow';
import './desktop.css';

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  // The panic key: Shift+Esc drops every connection at once.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.shiftKey) {
        event.preventDefault();
        session.dispatch({ type: 'disconnectAll' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="desktop">
      <TopBar />
      <main class="workspace">
        <GatewayWindow />
        <MapWindow />
        <ServerWindow />
        <ProgramsWindow />
        <MessagesWindow />
        <ContractWindow />
        <SavesWindow />
      </main>
      <BottomBar />
    </div>
  );
}
