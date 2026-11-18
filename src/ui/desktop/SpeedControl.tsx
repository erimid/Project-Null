import { SPEEDS, effectiveSpeed, isConnected, type Speed } from '../../core';
import { useGame } from '../hooks';
import { session } from '../session';

const LABELS: Record<Speed, string> = { 0: 'Pause', 1: '1×', 2: '2×', 4: '4×' };

/** Pause and 1×/2×/4×. Locked to real time while any connection is open. */
export function SpeedControl() {
  const locked = useGame(isConnected);
  const current = useGame(effectiveSpeed);

  return (
    <div class="speed" role="group" aria-label="Game speed">
      {SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          class={`speed__option${speed === current ? ' is-current' : ''}`}
          aria-pressed={speed === current}
          disabled={locked}
          title={locked ? 'Time is locked while a connection is open' : undefined}
          onClick={() => session.dispatch({ type: 'setSpeed', speed })}
        >
          {LABELS[speed]}
        </button>
      ))}
    </div>
  );
}
