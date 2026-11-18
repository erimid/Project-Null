import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { GatewayWindow } from './windows/GatewayWindow';
import { MapWindow } from './windows/MapWindow';
import { SavesWindow } from './windows/SavesWindow';
import { ServerWindow } from './windows/ServerWindow';
import './desktop.css';

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  return (
    <div class="desktop">
      <TopBar />
      <main class="workspace">
        <GatewayWindow />
        <MapWindow />
        <ServerWindow />
        <SavesWindow />
      </main>
      <BottomBar />
    </div>
  );
}
