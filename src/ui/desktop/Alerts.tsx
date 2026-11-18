import { useEffect, useState } from 'preact/hooks';
import { session } from '../session';

interface Alert {
  readonly id: number;
  readonly title: string;
  readonly text: string;
  /** A trace cutting the line is louder and stays longer than the player hanging up. */
  readonly severe: boolean;
  /** Good news, shown in green. */
  readonly good?: boolean;
}

const SHOW_MS = 4000;
const SHOW_SEVERE_MS = 9000;

/** Notices that drop in at the top of the desktop when a connection ends or the player earns a new title. Click one to dismiss it. */
export function Alerts() {
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);

  useEffect(() => {
    let nextId = 1;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = session.subscribeEvents((event) => {
      if (event.type !== 'disconnected' && event.type !== 'promoted') return;
      const alert: Alert = event.type === 'promoted'
        ? { id: nextId++, severe: false, good: true, title: 'New standing', text: `The board now knows you as ${event.title}.` }
        : event.traced
        ? { id: nextId++, severe: true, title: 'Trace complete', text: `They found you. ${event.server} cut the connection.` }
        : event.pulled
          ? { id: nextId++, severe: false, title: 'Pulled out', text: `Your model cut the line to ${event.server} just before the trace reached you.` }
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
          class={`alert${alert.severe ? ' alert--severe' : ''}${alert.good ? ' alert--good' : ''}`}
          title="Dismiss"
          onClick={() => setAlerts((list) => list.filter((item) => item.id !== alert.id))}
        >
          <span class="alert__mark" aria-hidden="true">
            {alert.good ? '▲' : '!'}
          </span>
          <span class="alert__title">{alert.title}</span>
          <span class="alert__text">{alert.text}</span>
        </button>
      ))}
    </div>
  );
}
