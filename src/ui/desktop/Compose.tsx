import { useState } from 'preact/hooks';
import {
  factsByFile,
  findPerson,
  hasSkill,
  judge,
  leads,
  modelWith,
  sendersFor,
  standing,
  type GameState,
  type Standing,
  type Verdict,
} from '../../core';
import type { AskDef } from '../../content/people';
import { content, session } from '../session';

const STANDING_NOTES: Record<Standing, string> = {
  open: '',
  waiting: 'waiting for their answer',
  wary: 'on guard for now',
  burned: 'will not answer you again',
};

const serverName = (serverId: string | null) =>
  serverId === null ? 'People you already know' : (content.servers.find((server) => server.id === serverId)?.name ?? serverId);

/** What a message would open with: the first name, or the whole name when it starts with a title or an initial. */
const firstName = (name: string) => {
  const first = name.split(' ')[0] ?? name;
  return first.endsWith('.') ? name : first;
};

/**
 * Writing to someone under a borrowed name. First a short list of leads:
 * one for each thing the player could still get from someone they have
 * found. Picking one opens that one message. Everything is picked,
 * nothing is typed.
 */
export function Compose({ game, onSent }: { game: GameState; onSent: (notice: string) => void }) {
  const [askId, setAskId] = useState<string | null>(null);
  const found = leads(game, content);
  const ask = found.open.find((item) => item.id === askId);

  if (ask) return <Letter key={ask.id} game={game} ask={ask} onBack={() => setAskId(null)} onSent={onSent} />;
  return <LeadList game={game} onPick={setAskId} />;
}

function LeadList({ game, onPick }: { game: GameState; onPick: (askId: string) => void }) {
  const [showDone, setShowDone] = useState(false);
  const { open, done } = leads(game, content);

  return (
    <div class="compose">
      {open.length === 0 ? (
        <p class="empty">
          You do not know of anybody worth writing to yet. Open files on the servers you get into. Your gateway notes every person
          they name and every detail worth repeating.
        </p>
      ) : (
        <>
          <h3 class="map__heading">
            Leads <span class="heading__note">people who could give you something · pick one to write</span>
          </h3>
          <ul class="leads">
            {open.map((ask) => {
              const mark = findPerson(content, ask.markId, game)!;
              const state = standing(game, content, mark.id);
              return (
                <li key={ask.id}>
                  <button type="button" class={`lead is-${state}`} onClick={() => onPick(ask.id)}>
                    <span class="lead__want">{ask.label}</span>
                    <span class="lead__who">
                      from <strong>{mark.name}</strong> · {mark.title}
                    </span>
                    {state !== 'open' && <span class="chip__flag">{STANDING_NOTES[state]}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {done.length > 0 && (
        <div class="leads__done">
          <button type="button" class="fold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <span class="fold__arrow" aria-hidden="true">
              {showDone ? '▾' : '▸'}
            </span>
            Done <span class="data">{done.length}</span>
          </button>
          {showDone && (
            <ul class="leads__done-list">
              {done.map((ask) => (
                <li key={ask.id}>
                  <span class="lead__check" aria-hidden="true">
                    ✓
                  </span>{' '}
                  {ask.label} <span class="chip__note">· {findPerson(content, ask.markId, game)?.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Letter({ game, ask, onBack, onSent }: { game: GameState; ask: AskDef; onBack: () => void; onSent: (notice: string) => void }) {
  const [senderId, setSenderId] = useState<string | null>(null);
  const [factIds, setFactIds] = useState<readonly string[]>([]);
  const [openFiles, setOpenFiles] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState('');
  // What the rented model said about the message, and which message it was about.
  const [review, setReview] = useState<{ of: string; verdict: Verdict } | null>(null);
  const model = modelWith(game, content, 'review');
  const canReview = hasSkill(game, content, 'review');

  const mark = findPerson(content, ask.markId, game)!;
  const senderGroups = sendersFor(game, content, mark.id);
  const sender = senderGroups.flatMap((group) => group.items).find((person) => person.id === senderId);
  const fileGroups = factsByFile(game, content);
  const facts = fileGroups.flatMap((group) => group.items);
  // Files read on the same server sit together under one fold.
  const serverGroups: { serverId: string | null; files: typeof fileGroups }[] = [];
  for (const group of fileGroups) {
    const at = serverGroups.find((item) => item.serverId === group.serverId);
    if (at) at.files.push(group);
    else serverGroups.push({ serverId: group.serverId, files: [group] });
  }
  const picked = factIds.map((id) => facts.find((fact) => fact.id === id)).filter((fact) => fact !== undefined);
  const most = content.rules.phishMaxDetails;
  const state = standing(game, content, mark.id);

  const toggle = (id: string) =>
    setFactIds((list) => (list.includes(id) ? list.filter((other) => other !== id) : list.length < most ? [...list, id] : list));
  const toggleFile = (key: string) => setOpenFiles((list) => (list.includes(key) ? list.filter((other) => other !== key) : [...list, key]));

  const draftKey = `${senderId}/${[...factIds].sort().join()}`;
  const readOver = () => {
    if (sender) setReview({ of: draftKey, verdict: judge(content, { askId: ask.id, senderId: sender.id, factIds }, game) });
  };
  const said = review?.of === draftKey ? review.verdict : null;

  const send = () => {
    if (!sender) return;
    const result = session.dispatch({ type: 'sendPhish', askId: ask.id, senderId: sender.id, factIds: [...factIds] });
    if (result.ok) onSent(`Sent to ${mark.name} as ${sender.name}. Answers take about ${content.rules.phishReplyMinutes} minutes.`);
    else setNotice(result.reason);
  };

  return (
    <div class="compose">
      <button type="button" class="fold compose__back" onClick={onBack}>
        <span aria-hidden="true">‹</span> All leads
      </button>
      <div class="lead lead--head">
        <span class="lead__want">{ask.label}</span>
        <span class="lead__who">
          from <strong>{mark.name}</strong> · {mark.title}
        </span>
        {state !== 'open' && <span class="chip__flag">{STANDING_NOTES[state]}</span>}
      </div>

      <h3 class="map__heading section-gap">
        <span class="step">1</span> Write as <span class="heading__note">somebody {firstName(mark.name)} would do this for</span>
      </h3>
      {sender ? (
        <div class="picked-line">
          <span class="chip is-picked chip--static">
            <strong>{sender.name}</strong>
            <span class="chip__note">{sender.title}</span>
          </span>
          <button type="button" class="fold" onClick={() => setSenderId(null)}>
            Change
          </button>
        </div>
      ) : (
        <ul class="files">
          {senderGroups.map((group) => {
            const key = `people/${group.serverId}`;
            const isOpen = openFiles.includes(key) !== (group.serverId !== null && group.serverId === mark.source?.serverId);
            return (
              <li key={key}>
                <button type="button" class="fold files__head" aria-expanded={isOpen} onClick={() => toggleFile(key)}>
                  <span class="fold__arrow" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span class="files__name">{group.serverId === null ? serverName(null) : `Found on ${serverName(group.serverId)}`}</span>
                  <span class="files__count data">{group.items.length}</span>
                </button>
                {isOpen && (
                  <div class="chips files__facts">
                    {group.items.map((person) => (
                      <button key={person.id} type="button" class="chip" onClick={() => setSenderId(person.id)}>
                        <strong>{person.name}</strong>
                        <span class="chip__note">{person.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3 class="map__heading section-gap">
        <span class="step">2</span> Mention{' '}
        <span class="heading__note">
          up to {most} details {sender ? firstName(sender.name) : 'that person'} would know ·{' '}
          <span class="data">
            {picked.length}/{most}
          </span>
        </span>
      </h3>
      {facts.length === 0 ? (
        <p class="empty">You have not noted any details yet. Open files and read them.</p>
      ) : (
        <>
          {picked.length > 0 && (
            <ul class="rows compose__picked" aria-label="In the message">
              {picked.map((fact) => (
                <li key={fact.id}>
                  <button type="button" class="fact is-picked" aria-pressed="true" onClick={() => toggle(fact.id)}>
                    <span class="fact__mark" aria-hidden="true">
                      ✓
                    </span>
                    <span>{fact.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul class="files">
            {serverGroups.map(({ serverId, files }) => {
              const key = `facts/${serverId}`;
              const isOpen = openFiles.includes(key);
              const all = files.flatMap((group) => group.items);
              const chosen = all.filter((fact) => factIds.includes(fact.id)).length;
              return (
                <li key={key}>
                  <button type="button" class="fold files__head" aria-expanded={isOpen} onClick={() => toggleFile(key)}>
                    <span class="fold__arrow" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <span class="files__name">Read on {serverName(serverId)}</span>
                    <span class="files__count data">{chosen > 0 ? `${chosen} of ${all.length}` : all.length}</span>
                  </button>
                  {isOpen &&
                    files.map((group) => (
                      <div key={group.file} class="files__facts">
                        <p class="pick-group__label data">{group.file}</p>
                        <ul class="rows">
                          {group.items.map((fact) => {
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
                                  <span>{fact.text}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {sender && (
        <article class="message-body compose__preview">
          <p class="message-body__meta">
            To {mark.name} <span class="data">{mark.address}</span> · From {sender.name} <span class="data">{sender.address}</span>
          </p>
          <p>{firstName(mark.name)},</p>
          <p>{ask.text}</p>
          {picked.length > 0 && <p>{picked.map((fact) => fact.mention).join(' ')}</p>}
          <p>{sender.name}</p>
        </article>
      )}
      {said && model && (
        <p class={`review is-${said}`}>
          <strong>{model.name}:</strong>{' '}
          {said === 'good'
            ? `This reads right. ${firstName(mark.name)} has no reason to doubt it.`
            : said === 'sender'
              ? `${firstName(mark.name)} would not do this for ${sender?.name}. It needs somebody else's name on it.`
              : `The name is right, but the details do not prove it is them. Something ${sender ? firstName(sender.name) : 'they'} would know is missing.`}
        </p>
      )}
      <div class="contract__actions">
        {canReview && model && (
          <button type="button" class="btn" disabled={!sender} onClick={readOver}>
            Have {model.name} read it over
          </button>
        )}
        {state !== 'open' && (
          <span class="compose__state">
            {mark.name} {STANDING_NOTES[state]}.
          </span>
        )}
        <button type="button" class="btn btn--go" disabled={!sender || state !== 'open'} onClick={send}>
          Send
        </button>
      </div>
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
