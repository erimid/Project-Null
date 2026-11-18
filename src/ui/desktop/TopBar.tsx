/**
 * Top bar: one tab per connected server, a + to open a new connection,
 * and the active contract on the right. Nothing is connected yet in this
 * build, so it shows the empty state.
 */
export function TopBar() {
  return (
    <header class="tabbar">
      <span class="tabbar__hint">No connections</span>
      <button class="tabbar__add" type="button" disabled aria-label="New connection">
        +
      </button>
      <span class="tabbar__contract">No active contract</span>
    </header>
  );
}
