import { useState } from 'preact/hooks';
import { findPerson, hasSkill, judge, knownFacts, knownPeople, marks, openAsks, modelWith, standing, type GameState, type Standing, type Verdict } from '../../core';
import { content, session } from '../session';

const STANDING_NOTES: Record<Standing, string> = {
  open: '',
  waiting: 'waiting for their answer',
  wary: 'on guard for now',
  burned: 'will not answer you again',
};

/**
 * Writing to someone under a borrowed name. Everything is picked, nothing
 * is typed: who it goes to, what it asks for, whose name is on it, and
 * the details it mentions.
 */
export function Compose({ game, onSent }: { game: GameState; onSent: (notice: string) => void }) {
  const [markId, setMarkId] = useState<string | null>(null);
  const [askId, setAskId] = useState<string | null>(null);
  const [senderId, setSenderId] = useState<string | null>(null);
  const [factIds, setFactIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState('');
  // What the rented model said about the message, and which message it was about.
  const [review, setReview] = useState<{ of: string; verdict: Verdict } | null>(null);
  const model = modelWith(game, content, 'review');
  const canReview = hasSkill(game, content, 'review');

  const targets = marks(game, content);
  if (targets.length === 0) {
    return (
      <p class="empty">
        You do not know of anybody worth writing to yet. Open files on the servers you get into. Your gateway notes every person
        they name and every detail worth repeating.
      </p>
    );
  }
  const mark = targets.find((person) => person.id === markId);
  const asks = mark ? openAsks(game, content, mark.id) : [];
  const ask = asks.find((item) => item.id === askId) ?? (asks.length === 1 ? asks[0] : undefined);
  const senders = knownPeople(game, content).filter((person) => person.id !== mark?.id);
  const sender = senders.find((person) => person.id === senderId);
  const facts = knownFacts(game, content);
  const picked = facts.filter((fact) => factIds.includes(fact.id));
  const most = content.rules.phishMaxDetails;
  const state = mark ? standing(game, content, mark.id) : 'open';
  const fileOf = (serverId: string, file: string) => `${content.servers.find((server) => server.id === serverId)?.name ?? serverId} · ${file}`;

  const toggle = (id: string) =>
    setFactIds((list) => (list.includes(id) ? list.filter((other) => other !== id) : list.length < most ? [...list, id] : list));

  const draftKey = `${ask?.id}/${senderId}/${[...factIds].sort().join()}`;
  const readOver = () => {
    if (ask && sender) setReview({ of: draftKey, verdict: judge(content, { askId: ask.id, senderId: sender.id, factIds: picked.map((fact) => fact.id) }) });
  };
  const said = review?.of === draftKey ? review.verdict : null;

  const send = () => {
    if (!ask || !sender || !mark) return;
    const result = session.dispatch({ type: 'sendPhish', askId: ask.id, senderId: sender.id, factIds: picked.map((fact) => fact.id) });
    if (result.ok) onSent(`Sent to ${mark.name} as ${sender.name}. Answers take about ${content.rules.phishReplyMinutes} minutes.`);
    else setNotice(result.reason);
  };

  return (
    <div class="compose">
      <h3 class="map__heading">To</h3>
      <div class="chips">
        {targets.map((person) => {
          const note = STANDING_NOTES[standing(game, content, person.id)];
          return (
            <button
              key={person.id}
              type="button"
              class={`chip${person.id === markId ? ' is-picked' : ''}`}
              aria-pressed={person.id === markId}
              onClick={() => {
                setMarkId(person.id);
                setAskId(null);
                if (senderId === person.id) setSenderId(null);
                setNotice('');
              }}
            >
              <strong>{person.name}</strong>
              <span class="chip__note">{person.title}</span>
              {note && <span class="chip__flag">{note}</span>}
            </button>
          );
        })}
      </div>

      {mark && (
        <>
          <h3 class="map__heading section-gap">Ask for</h3>
          <div class="chips">
            {asks.map((item) => (
              <button
                key={item.id}
                type="button"
                class={`chip${item.id === ask?.id ? ' is-picked' : ''}`}
                aria-pressed={item.id === ask?.id}
                onClick={() => setAskId(item.id)}
              >
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>

          <h3 class="map__heading section-gap">
            Write as <span class="heading__note">somebody {mark.name.split(' ')[0]} would do this for</span>
          </h3>
          <div class="chips">
            {senders.map((person) => (
              <button
                key={person.id}
                type="button"
                class={`chip${person.id === senderId ? ' is-picked' : ''}`}
                aria-pressed={person.id === senderId}
                onClick={() => setSenderId(person.id)}
              >
                <strong>{person.name}</strong>
                <span class="chip__note">{person.title}</span>
              </button>
            ))}
          </div>

          <h3 class="map__heading section-gap">
            Mention{' '}
            <span class="heading__note">
              up to {most} details that person would know · <span class="data">{picked.length}</span> picked
            </span>
          </h3>
          {facts.length === 0 ? (
            <p class="empty">You have not noted any details yet. Open files and read them.</p>
          ) : (
            <ul class="rows rows--scroll compose__facts">
              {facts.map((fact) => {
                const on = factIds.includes(fact.id);
                return (
                  <li key={fact.id}>
                    <button
                      type="button"
                      class={`fact${on ? ' is-picked' : ''}`}
                      aria-pressed={on}
                      disabled={!on && picked.length >= most}
                      onClick={() => toggle(fact.id)}
                    >
                      <span class="fact__mark" aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span>
                        {fact.text}
                        <span class="fact__source data">{fileOf(fact.source.serverId, fact.source.file)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {ask && sender && (
            <article class="message-body compose__preview">
              <p class="message-body__meta">
                To {mark.name} <span class="data">{mark.address}</span> · From {sender.name}{' '}
                <span class="data">{sender.address}</span>
              </p>
              <p>{mark.name.split(' ')[0]},</p>
              <p>{ask.text}</p>
              {picked.length > 0 && <p>{picked.map((fact) => fact.text).join(' ')}</p>}
              <p>{sender.name}</p>
            </article>
          )}
          {said && model && (
            <p class={`review is-${said}`}>
              <strong>{model.name}:</strong>{' '}
              {said === 'good'
                ? `This reads right. ${mark.name.split(' ')[0]} has no reason to doubt it.`
                : said === 'sender'
                  ? `${mark.name.split(' ')[0]} would not do this for ${sender?.name}. It needs somebody else's name on it.`
                  : `The name is right, but the details do not prove it is them. Something ${sender?.name.split(' ')[0]} would know is missing.`}
            </p>
          )}
          <div class="contract__actions">
            {canReview && model && (
              <button type="button" class="btn" disabled={!ask || !sender} onClick={readOver}>
                Have {model.name} read it over
              </button>
            )}
            {state !== 'open' && <span class="compose__state">{findPerson(content, mark.id)?.name} {STANDING_NOTES[state]}.</span>}
            <button type="button" class="btn btn--go" disabled={!ask || !sender || state !== 'open'} onClick={send}>
              Send
            </button>
          </div>
        </>
      )}
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
