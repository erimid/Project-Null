import { useEffect, useState } from 'preact/hooks';
import { session } from '../session';

interface Alert {
  readonly id: number;
  readonly title: string;
  readonly text: string;
  /** A trace cutting the line is louder and stays longer than the player hanging up. */
  readonly severe: boolean;
}

const SHOW_MS = 4000;
const SHOW_SEVERE_MS = 9000;

/** Red warnings that drop in at the top of the desktop when a connection ends. Click one to dismiss it. */
export function Alerts() {
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);

  useEffect(() => {
    let nextId = 1;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = session.subscribeEvents((event) => {
      if (event.type !== 'disconnected') return;
      const alert: Alert = event.traced
        ? { id: nextId++, severe: true, title: 'Trace complete', text: `They found you. ${event.server} cut the connection.` }
        : { id: nextId++, severe: false, title: 'Disconnected', text: `Connection to ${event.server} closed.` };
      setAlerts((list) => [...list, alert]);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          setAlerts((list) => list.filter((item) => item.id !== alert.id));
        },
        alert.severe ? SHOW_SEVERE_MS : SHOW_MS,
      );
      timers.add(timer);
    });
    return () => {
      stop();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div class="alerts" role="alert">
      {alerts.map((alert) => (
        <button
          key={alert.id}
          type="button"
          class={`alert${alert.severe ? ' alert--severe' : ''}`}
          title="Dismiss"
          onClick={() => setAlerts((list) => list.filter((item) => item.id !== alert.id))}
        >
          <span class="alert__mark" aria-hidden="true">
            !
          </span>
          <span class="alert__title">{alert.title}</span>
          <span class="alert__text">{alert.text}</span>
        </button>
      ))}
    </div>
  );
}
