import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { WINDOW_DEFS, windows, useWindows, type WindowId } from './windowStore';

/** How much of a window must stay on screen so it can always be grabbed again. */
const KEEP_VISIBLE = 80;
const TITLE_HEIGHT = 40;

interface Props {
  id: WindowId;
  /** Shown instead of the window's usual title. */
  title?: string;
  /** Small dim text next to the title. */
  note?: string;
  /** Buttons shown on the right of the title bar. */
  actions?: ComponentChildren;
  children: ComponentChildren;
}

/**
 * A floating window. Drag it by its title bar; click anywhere on it to
 * bring it to the front; × closes it (its bottom-bar tab reopens it).
 */
export function Window({ id, title, note, actions, children }: Props) {
  const layout = useWindows()[id];
  const def = WINDOW_DEFS[id];
  const frame = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  if (!layout.open) return null;

  const clamp = (x: number, y: number): [number, number] => {
    const area = frame.current?.parentElement;
    if (!area) return [x, y];
    return [
      Math.min(Math.max(x, KEEP_VISIBLE - def.width), area.clientWidth - KEEP_VISIBLE),
      Math.min(Math.max(y, 0), area.clientHeight - TITLE_HEIGHT),
    ];
  };
  // Also applied when drawing, so a window saved on a bigger screen can't be lost off the edge.
  const [x, y] = clamp(layout.x, layout.y);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = { pointerId: event.pointerId, dx: event.clientX - x, dy: event.clientY - y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    windows.move(id, ...clamp(event.clientX - active.dx, event.clientY - active.dy));
  };
  const endDrag = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    windows.settle();
  };

  return (
    <section
      ref={frame}
      class={`window${windows.isOnTop(id) ? ' window--front' : ''}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${def.width}px`, zIndex: layout.z }}
      aria-label={title ?? def.title}
      onPointerDownCapture={() => windows.focus(id)}
    >
      <div
        class="window__title"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span class="window__title-text">{title ?? def.title}</span>
        {note && <span class="window__title-note">{note}</span>}
        <span class="window__title-gap" />
        {actions}
        <button class="window__close" type="button" aria-label={`Close ${title ?? def.title}`} onClick={() => windows.close(id)}>
          ×
        </button>
      </div>
      <div class="window__body">{children}</div>
    </section>
  );
}
