import { BottomBar } from './BottomBar';
import { GatewayWindow } from './GatewayWindow';
import { TopBar } from './TopBar';
import './desktop.css';

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  return (
    <div class="desktop">
      <TopBar />
      <main class="workspace">
        <GatewayWindow />
      </main>
      <BottomBar />
    </div>
  );
}
