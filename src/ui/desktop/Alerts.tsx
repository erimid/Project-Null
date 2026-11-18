import { useEffect, useState } from 'preact/hooks';
import { session } from '../session';
import { windows, type WindowId } from './windowStore';

interface Alert {
  readonly id: number;
  readonly title: string;
  readonly text: string;
  /** A trace cutting the line is louder and stays longer than the player hanging up. */
  readonly severe: boolean;
  /** Good news, shown in green. */
  readonly good?: boolean;
  /** The window a click opens, for news that wants acting on. */
  readonly opens?: WindowId;
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
      if (event.type === 'moduleGained' && event.bought) return;
      if (event.type !== 'disconnected' && event.type !== 'promoted' && event.type !== 'pointEarned' && event.type !== 'moduleGained') return;
      const alert: Alert = event.type === 'promoted'
        ? { id: nextId++, severe: false, good: true, title: 'New standing', text: `The board now knows you as ${event.title}.` }
        : event.type === 'pointEarned'
        ? { id: nextId++, severe: false, good: true, opens: 'skills', title: 'Skill point', text: event.free === 1 ? 'You have a point to spend. Open Skills.' : `You have ${event.free} points to spend. Open Skills.` }
        : event.type === 'moduleGained'
        ? { id: nextId++, severe: false, good: true, opens: 'workbench', title: 'New module', text: `${event.name} is on your Workbench shelf.` }
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
          title={alert.opens ? 'Open it' : 'Dismiss'}
          onClick={() => {
            if (alert.opens) windows.focus(alert.opens);
            setAlerts((list) => list.filter((item) => item.id !== alert.id));
          }}
        >
          <span class="alert__mark" aria-hidden="true">
            {alert.opens === 'skills' ? '◆' : alert.opens === 'workbench' ? '✚' : alert.good ? '▲' : '!'}
          </span>
          <span class="alert__title">{alert.title}</span>
          <span class="alert__text">{alert.text}</span>
        </button>
      ))}
    </div>
  );
}
