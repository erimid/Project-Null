import { gameInfo } from '../../content';

/**
 * Bottom bar: player handle, program pills (none yet), trace status,
 * balance and clock, and the Disconnect pill.
 */
export function BottomBar() {
  return (
    <footer class="bottombar">
      <span class="bottombar__handle">{gameInfo.defaultHandle}</span>
      <span class="bottombar__spacer" />
      <span class="pill pill--quiet">
        <span class="pill__dot" aria-hidden="true" />
        No trace
      </span>
      <span class="bottombar__status data">0{gameInfo.currencySuffix} · 00:00</span>
      <button class="pill pill--danger" type="button" disabled>
        Disconnect
      </button>
    </footer>
  );
}
