/**
 * A file name that wraps after an underscore, a dot or a dash when it is
 * too long for its column, and never in the middle of a word.
 */
export function FileName({ name }: { name: string }) {
  const parts = name.split(/(?<=[_.-])/);
  return (
    <span class="filename">
      {parts.map((part, index) => (
        <>
          {index > 0 && <wbr />}
          {part}
        </>
      ))}
    </span>
  );
}
