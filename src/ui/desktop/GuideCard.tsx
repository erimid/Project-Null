import { useGuide } from './guide';

/** Wren's line for the first job: what to press next. The button it means is lit up on the desk. */
export function GuideCard() {
  const guide = useGuide();
  if (!guide) return null;
  return (
    <div class="guide" role="status" aria-live="polite">
      <span class="guide__who">Wren</span>
      <span class="guide__text">{guide.text}</span>
    </div>
  );
}
