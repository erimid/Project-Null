import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { GatewayWindow } from './windows/GatewayWindow';
import { SavesWindow } from './windows/SavesWindow';
import './desktop.css';

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  return (
    <div class="desktop">
      <TopBar />
      <main class="workspace">
        <GatewayWindow />
        <SavesWindow />
      </main>
      <BottomBar />
    </div>
  );
}
