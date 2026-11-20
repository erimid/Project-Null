import type { ComponentChildren } from 'preact';
import { deskStore } from '../deskStore';
import { windows } from '../windowStore';

/** Shows a server on the route map, picked and in view. */
export function showOnMap(serverId: string) {
  deskStore.select(serverId);
  windows.focus('map');
}

/** A server's name as a link that opens it on the route map. */
export function Place({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <button type="button" class="place" data-tip="Show this server on the route map" onClick={() => showOnMap(id)}>
      {children}
    </button>
  );
}

/** What each kind of job asks for, in three words or fewer. */
export const OBJECTIVE_WORDS: Record<string, string> = {
  steal: 'Steal a file',
  destroy: 'Delete a file',
  record: 'Change a record',
  read: 'Read a file',
  plant: 'Plant a file',
  frame: 'Frame someone',
};

/** How dangerous a job looks, for each risk level 0 to 5. */
export const RISK_WORDS = ['open door', 'low', 'guarded', 'tight', 'hard', 'fortress'];

/** A risk level as five pips and a word. */
export function RiskMeter({ risk }: { risk: number }) {
  const level = Math.max(0, Math.min(5, risk));
  return (
    <span class={`risk risk--${level}`} role="img" aria-label={`Risk: ${RISK_WORDS[level]}`} data-tip="How strong the target's security is. A Scanner reads it layer by layer.">
      <span class="risk__label">Risk</span>
      <span class="risk__pips" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} class={index < level ? 'is-on' : ''} />
        ))}
      </span>
      <span class="risk__word">{RISK_WORDS[level]}</span>
    </span>
  );
}
