/**
 * Whether windows snap (a setting kept per browser, like sound), and the
 * outline that shows where a dragged window will land.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Rect } from './snap';

const STORAGE_KEY = 'project-null.snap.v1';

function load(): boolean {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof saved === 'object' && saved !== null && typeof (saved as { on?: unknown }).on === 'boolean') {
      return (saved as { on: boolean }).on;
    }
  } catch {
    // Unreadable or blocked storage: snapping stays on.
  }
  return true;
}

let on = load();
let preview: Rect | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

export const snapping = {
  isOn: (): boolean => on,
  setOn(value: boolean): void {
    on = value;
    tell();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ on }));
    } catch {
      // Storage full or blocked: the setting just won't be remembered.
    }
  },
  /** The outline of where a dragged window will land, or null for none. */
  preview: (): Rect | null => preview,
  setPreview(rect: Rect | null): void {
    if (rect === preview || (rect && preview && rect.x === preview.x && rect.y === preview.y && rect.w === preview.w && rect.h === preview.h)) return;
    preview = rect;
    tell();
  },
};

export function useSnapping(): { on: boolean; preview: Rect | null } {
  const read = () => ({ on, preview });
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    update();
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return value;
}

/** The outline drawn on the desk while a window is dragged into a zone. */
export function SnapPreview() {
  const { preview: rect } = useSnapping();
  if (!rect) return null;
  return (
    <div
      class="snap-preview"
      aria-hidden="true"
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}
    />
  );
}
