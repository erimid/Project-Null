/** Which file the file viewer is showing. Screen state only; not saved. */
import { useEffect, useState } from 'preact/hooks';
import { windows } from './windowStore';

export interface OpenFile {
  /** Server the file is on, or was copied from. */
  readonly serverId: string;
  readonly name: string;
  readonly sizeGq: number;
}

let current: OpenFile | null = null;
const listeners = new Set<() => void>();

export const viewer = {
  get: (): OpenFile | null => current,
  /** Shows a file and brings the viewer to the front. */
  open(file: OpenFile): void {
    current = file;
    listeners.forEach((listener) => listener());
    windows.focus('viewer');
  },
};

export function useViewer(): OpenFile | null {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const update = () => setValue(current);
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}
