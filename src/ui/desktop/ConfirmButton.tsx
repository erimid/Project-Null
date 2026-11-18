import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

interface Props {
  class?: string;
  /** What the button says while waiting for the second click. */
  confirmLabel?: string;
  onConfirm: () => void;
  /** Hover label: what the button does. */
  tip?: string;
  children: ComponentChildren;
}

/**
 * A button for actions that can't be undone. The first click arms it and
 * changes its label; a second click within a few seconds does the action.
 */
export function ConfirmButton({ class: className = '', confirmLabel = 'Sure?', onConfirm, tip, children }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      class={`${className}${armed ? ' is-armed' : ''}`}
      data-tip={tip && `${tip} Press twice to be sure.`}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
