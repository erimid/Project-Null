import { SPEEDS, effectiveSpeed, isConnected, type Speed } from '../../core';
import { useGame } from '../hooks';
import { session } from '../session';

const LABELS: Record<Speed, string> = { 0: 'Pause', 1: '1×', 2: '2×', 4: '4×' };
const KEYS: Record<Speed, string> = { 0: 'Space', 1: '1', 2: '2', 4: '3' };

/** Pause and 1×/2×/4×. Locked to real time while any connection is open. The keys are handled in Desktop. */
export function SpeedControl() {
  const locked = useGame(isConnected);
  const current = useGame(effectiveSpeed);

  return (
    <div class="speed" role="group" aria-label="Game speed" data-tour="speed">
      {SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          class={`speed__option${speed === current ? ' is-current' : ''}`}
          aria-pressed={speed === current}
          disabled={locked}
          aria-label={speed === 0 ? 'Pause' : undefined}
          title={locked ? 'Time is locked while a connection is open' : undefined}
          data-tip={locked ? undefined : `${speed === 0 ? 'Pause the clock' : `Run the clock at ${LABELS[speed]}`}. Key: ${KEYS[speed]}`}
          onClick={() => session.dispatch({ type: 'setSpeed', speed })}
        >
          {speed === 0 ? <span class="speed__pause" aria-hidden="true" /> : LABELS[speed]}
        </button>
      ))}
    </div>
  );
}
