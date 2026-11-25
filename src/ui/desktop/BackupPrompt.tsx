/**
 * At each new title and at an ending, a small card offers to download the
 * career as a file: the save lives in the browser, and a browser can lose
 * it. The Saved games window says when each slot was last backed up.
 */
import { useEffect, useState } from 'preact/hooks';
import { backUp } from '../backup';
import { useSaveStatus } from '../hooks';
import { session } from '../session';
import { backups } from '../storage/backupStore';

type Moment = { readonly kind: 'title'; readonly title: string } | { readonly kind: 'ending'; readonly name: string };

export function BackupPrompt() {
  const [moment, setMoment] = useState<Moment | null>(null);
  const status = useSaveStatus();

  useEffect(
    () =>
      session.subscribeEvents((event) => {
        if (event.type === 'promoted') setMoment({ kind: 'title', title: event.title });
        else if (event.type === 'ended') setMoment({ kind: 'ending', name: event.name });
        else return;
        // A good moment, too, to ask the browser to keep the game's storage.
        if (backups.get().kept === null) void backups.askToKeep();
      }),
    [],
  );

  if (!moment || !status.persistent) return null;
  const handle = session.getState().player.handle;
  return (
    <aside class="backup" aria-label="Back up your career">
      <p class="backup__title">{moment.kind === 'title' ? `You are now ${moment.title}` : 'The story is over'}</p>
      <p class="backup__text">
        {moment.kind === 'title'
          ? 'A good moment to keep a copy of this career. Saves live in this browser, and clearing it would lose them.'
          : `${moment.name}. Keep a copy of this career, to look back on or to carry on from.`}
      </p>
      <div class="backup__actions">
        <button
          type="button"
          class="btn btn--go"
          onClick={() => {
            void backUp(status.activeSlot, handle);
            setMoment(null);
          }}
        >
          Download a backup
        </button>
        <button type="button" class="btn" onClick={() => setMoment(null)}>
          Not now
        </button>
      </div>
    </aside>
  );
}
