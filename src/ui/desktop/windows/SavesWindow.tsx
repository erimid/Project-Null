import { front } from '../../title/front';
import { useEffect, useRef } from 'preact/hooks';
import { backUp } from '../../backup';
import { backups, useBackups } from '../../storage/backupStore';
import { formatGameTime, formatMoney, formatSavedAt } from '../../format';
import { useSaveStatus } from '../../hooks';
import { SLOT_COUNT, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { Window } from '../Window';

/** "never", or when the slot was last downloaded, if it still holds the same career. */
function lastBackup(at: number | undefined): string {
  return at === undefined ? 'never backed up' : `backed up ${formatSavedAt(new Date(at).toISOString())}`;
}

/** Three save slots: save, load, start over, and move saves in and out as files. */
export function SavesWindow() {
  const status = useSaveStatus();
  const filePicker = useRef<HTMLInputElement>(null);
  const importTarget = useRef(1);

  const safety = useBackups();
  // Opening the saves is a fair moment to ask the browser to keep them.
  useEffect(() => {
    if (status.persistent && safety.kept === null) void backups.askToKeep();
  }, []);

  const pickFile = (slot: number) => {
    importTarget.current = slot;
    filePicker.current?.click();
  };

  const onFilePicked = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void session.importInto(importTarget.current, await file.text());
  };

  return (
    <Window id="saves" note={`autosaves to slot ${status.activeSlot}`}>
      <ul class="slots">
        {Array.from({ length: SLOT_COUNT }, (_, index) => {
          const slot = index + 1;
          const save = status.slots[index] ?? null;
          const active = slot === status.activeSlot;
          return (
            <li key={slot} class={`slot${active ? ' slot--active' : ''}`}>
              <div class="slot__label">
                Slot {slot}
                {active && <span class="slot__tag">in use</span>}
              </div>
              {save ? (
                <div class="slot__info data">
                  <span>
                    <span class="slot__who">{save.handle}</span> · {formatMoney(save.balance)}
                  </span>
                  <span>{formatGameTime(save.gameTimeMs)}</span>
                  <span class="slot__saved">saved {formatSavedAt(save.savedAt)}</span>
                  <span class={`slot__saved${safety.slots[slot]?.handle === save.handle ? '' : ' is-warn'}`}>
                    {lastBackup(safety.slots[slot]?.handle === save.handle ? safety.slots[slot]!.at : undefined)}
                  </span>
                </div>
              ) : (
                <div class="slot__info slot__info--empty data">empty</div>
              )}
              <div class="slot__actions">
                {save ? (
                  <>
                    {active ? (
                      <button type="button" class="btn" onClick={() => void session.saveTo(slot)}>
                        Save
                      </button>
                    ) : (
                      <>
                        <ConfirmButton class="btn" confirmLabel="Overwrite?" onConfirm={() => void session.saveTo(slot)}>
                          Save
                        </ConfirmButton>
                        <button type="button" class="btn" onClick={() => void session.loadFrom(slot)}>
                          Load
                        </button>
                      </>
                    )}
                    <button type="button" class="btn" data-tip="Download this career as a file, to keep it safe or move it to another browser" onClick={() => void backUp(slot, save.handle)}>
                      Export
                    </button>
                    {active ? (
                      <button type="button" class="btn" data-tip="Pick a handle, a difficulty and a world on the title screen. Nothing is erased until you begin." onClick={() => front.toTitle('new', slot)}>
                        New game
                      </button>
                    ) : (
                      <ConfirmButton
                        class="btn btn--danger"
                        confirmLabel="Delete?"
                        onConfirm={() => void session.deleteSlot(slot)}
                      >
                        Delete
                      </ConfirmButton>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" class="btn" onClick={() => void session.saveTo(slot)}>
                      Save here
                    </button>
                    <button type="button" class="btn" onClick={() => front.toTitle('new', slot)}>
                      New game
                    </button>
                    <button type="button" class="btn" onClick={() => pickFile(slot)}>
                      Import
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <input
        ref={filePicker}
        class="visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Save file to import"
        tabIndex={-1}
        onChange={onFilePicked}
      />

      <p class={`saves__notice${status.noticeIsError ? ' is-error' : ''}`} role="status">
        {status.notice || 'The game saves itself every minute and when you leave the page.'}
      </p>
      {status.persistent && safety.kept === false && (
        <p class="saves__notice">The browser may clear its storage when space runs low. Export a slot now and then to keep a copy.</p>
      )}
      {status.persistent && safety.kept === true && <p class="saves__notice">The browser has promised to keep these saves.</p>}
      {!status.persistent && (
        <p class="saves__notice is-error">
          This browser is blocking storage, so saves will be lost when the tab closes. Export a save to keep it.
        </p>
      )}
    </Window>
  );
}
