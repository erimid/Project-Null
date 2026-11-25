import { download } from './download';
import { session } from './session';
import { backups } from './storage/backupStore';

/** Downloads a slot as a file the player keeps, and notes when. False if the slot is empty. */
export async function backUp(slot: number, handle: string): Promise<boolean> {
  const text = await session.exportSlot(slot);
  if (text === null) return false;
  download(`project-null-${handle.toLowerCase()}-slot${slot}.json`, text);
  backups.noted(slot, handle);
  return true;
}
