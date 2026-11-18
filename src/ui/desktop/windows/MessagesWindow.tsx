import { useEffect, useRef, useState } from 'preact/hooks';
import { formatGameTime } from '../../format';
import { useWorld } from '../../hooks';
import { session } from '../../session';
import { Window } from '../Window';
import { windows } from '../windowStore';

/** The player's inbox. A new message brings the window to the front. */
export function MessagesWindow() {
  const messages = useWorld((game) => game.messages);
  const [openId, setOpenId] = useState<string | null>(null);

  // Remember the newest message seen, so only one that arrives while playing pops the window up.
  const newest = messages.at(-1)?.id ?? null;
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen.current !== undefined && newest !== null && newest !== seen.current && !messages.at(-1)?.read) {
      windows.focus('messages');
      setOpenId(newest);
      session.dispatch({ type: 'readMessage', messageId: newest });
    }
    seen.current = newest;
  }, [newest]);

  const unread = messages.filter((message) => !message.read).length;
  const open = messages.find((message) => message.id === openId);

  return (
    <Window id="messages" note={unread > 0 ? `${unread} unread` : `${messages.length} total`}>
      {messages.length === 0 ? (
        <p class="empty">No messages.</p>
      ) : (
        <ul class="rows rows--scroll">
          {[...messages].reverse().map((message) => (
            <li key={message.id}>
              <button
                type="button"
                class={`message${message.id === openId ? ' is-selected' : ''}${message.read ? '' : ' is-unread'}`}
                aria-pressed={message.id === openId}
                onClick={() => {
                  setOpenId(message.id);
                  if (!message.read) session.dispatch({ type: 'readMessage', messageId: message.id });
                }}
              >
                <span class="message__from">{message.from}</span>
                <span class="message__subject">{message.subject}</span>
                <span class="message__time data">{formatGameTime(message.timeMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <article class="message-body">
          <h3 class="message-body__subject">{open.subject}</h3>
          <p class="message-body__meta">
            From {open.from} · <span class="data">{formatGameTime(open.timeMs)}</span>
          </p>
          {open.body.split('\n').map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </article>
      )}
    </Window>
  );
}
