import type { CaseFileView } from '../../core';

/** The Case file tab of Messages: who the player has met, each side's thread, the choices made, and the hidden name so far. */
export function CaseFile({ file }: { readonly file: CaseFileView }) {
  if (file.people.length === 0 && file.threads.length === 0) {
    return <p class="empty">Nothing on file yet. The people you meet in the story are written up here.</p>;
  }
  return (
    <div class="casefile">
      {file.name && (
        <section class="casefile__part casefile__name" aria-label="The name">
          <h3 class="casefile__head">The name</h3>
          <p class="casefile__blocks data" aria-label={file.name.full ? file.name.blocks.join('') : 'The name, partly found'}>
            {file.name.blocks.map((block, index) => (
              <span key={index} class={`casefile__block${block === null ? ' is-missing' : ''}`}>
                {block ?? '_'}
              </span>
            ))}
          </p>
          {file.name.loose.length > 0 && (
            <p class="casefile__loose">
              Letters found: <span class="data">{file.name.loose.join(' ')}</span>
            </p>
          )}
          <p class="casefile__note">{file.name.note}</p>
        </section>
      )}
      <section class="casefile__part" aria-label="People">
        <h3 class="casefile__head">People</h3>
        <ul class="casefile__cards">
          {file.people.map((person) => (
            <li key={person.id} class="casefile__card">
              <span class="casefile__who">{person.name}</span>
              <span class="casefile__text">{person.text}</span>
            </li>
          ))}
        </ul>
      </section>
      {file.threads.length > 0 && (
        <section class="casefile__part" aria-label="Threads">
          <h3 class="casefile__head">Threads</h3>
          <ul class="casefile__cards">
            {file.threads.map((thread) => (
              <li key={thread.id} class={`casefile__card${thread.open ? '' : ' is-closed'}`}>
                <span class="casefile__who">
                  {thread.title}
                  <span class={`casefile__state${thread.open ? ' is-open' : ''}`}>{thread.open ? 'open' : 'closed'}</span>
                </span>
                <span class="casefile__text">{thread.text}</span>
                {thread.job && <span class="casefile__job">On the board: {thread.job}</span>}
                {thread.waiting.length > 0 && (
                  <ul class="casefile__needs">
                    {thread.waiting.map((need) => (
                      <li key={need.note} class={need.met ? 'is-met' : undefined}>
                        {need.met ? '✓ ' : '○ '}
                        {need.note}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {file.choices.length > 0 && (
        <section class="casefile__part" aria-label="Choices">
          <h3 class="casefile__head">Choices</h3>
          <ul class="casefile__cards">
            {file.choices.map((choice) => (
              <li key={choice.contractId} class="casefile__card">
                <span class="casefile__who">{choice.title}</span>
                <span class="casefile__text">{choice.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
