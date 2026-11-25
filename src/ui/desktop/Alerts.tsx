import { useEffect, useState } from 'preact/hooks';
import { content, session } from '../session';
import { deskStore } from './deskStore';
import { windows, type WindowId } from './windowStore';

interface Alert {
  readonly id: number;
  readonly title: string;
  readonly text: string;
  /** A trace cutting the line is louder and stays longer than the player hanging up. */
  readonly severe: boolean;
  /** Chorus's doing, shown in violet. */
  readonly chorus?: boolean;
  /** Good news, shown in green. */
  readonly good?: boolean;
  /** The window a click opens, for news that wants acting on. */
  /** A window to open when it is pressed, or the contract drop-down, or the Workbench side of Programs. */
  readonly opens?: WindowId | 'contract' | 'workbench';
}

const SHOW_MS = 4000;
const SHOW_CALM_MS = 2800;
const SHOW_SEVERE_MS = 9000;

/** Plain news that is neither danger nor good: you hung up, or a model pulled you out. Quiet, small, and never in the way of a click. */
function isCalm(alert: Alert): boolean {
  return !alert.severe && !alert.good && !alert.chorus;
}

/** Notices that drop in at the top of the desktop when a connection ends or the player earns a new title. Click one to dismiss it. */
export function Alerts() {
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);

  useEffect(() => {
    let nextId = 1;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = session.subscribeEvents((event) => {
      if (event.type === 'moduleGained' && event.bought) return;
      const shown = ['disconnected', 'promoted', 'pointEarned', 'moduleGained', 'raidStarted', 'barrierFell', 'portShut', 'raidEnded', 'stepDone', 'serverTaken', 'allyLetGo'];
      if (!shown.includes(event.type)) return;
      const chorus = content.chorus?.rival.handle;
      const alert: Alert = event.type === 'serverTaken'
        ? { id: nextId++, severe: false, chorus: true, opens: 'map', title: 'Taken', text: `${event.server} has gone quiet. Something is tidying it.` }
        : event.type === 'raidStarted' && event.who === chorus
        ? { id: nextId++, severe: true, chorus: true, opens: 'defence', title: 'Something is knocking', text: 'Chorus is at your gateway. It cannot be traced. Open Defence and hold it off.' }
        : event.type === 'raidStarted'
        ? { id: nextId++, severe: true, opens: 'defence', title: 'Intrusion', text: `${event.who} is breaking into your gateway. Open Defence.` }
        : event.type === 'barrierFell'
        ? { id: nextId++, severe: true, opens: 'defence', title: 'Barrier down', text: event.left === 1 ? 'One barrier left between them and your gateway.' : `${event.left} barriers left between them and your gateway.` }
        : event.type === 'portShut'
        ? { id: nextId++, severe: false, good: true, title: 'Port shut', text: 'You set them back. The next port buys less time.' }
        : event.type === 'raidEnded'
        ? event.result === 'won'
          ? { id: nextId++, severe: false, good: true, opens: 'messages', title: 'Traced', text: `You have ${event.who}'s address. Their server is in your address book.` }
          : event.result === 'lost'
          ? event.who === chorus
            ? { id: nextId++, severe: true, chorus: true, opens: 'messages', title: 'It got in', text: 'Chorus took something it thinks you are better off without. See Messages.' }
            : { id: nextId++, severe: true, opens: 'messages', title: 'They got in', text: `${event.who} broke through. See Messages for what it cost.` }
          : event.result === 'held'
          ? { id: nextId++, severe: false, good: true, opens: 'messages', title: 'Held off', text: `${event.who} gave up. Nothing is missing.` }
          : { id: nextId++, severe: false, title: 'Plug pulled', text: `${event.who} got nothing, and nor did you.` }
        : event.type === 'allyLetGo'
        ? { id: nextId++, severe: true, opens: 'contract' as const, title: `${event.who} let go`, text: `${event.server} is yours to hold now, or be quick.` }
        : event.type === 'stepDone'
        ? { id: nextId++, severe: false, good: true, opens: 'contract' as const, title: `Step ${event.step} of ${event.of} done`, text: 'The client has sent the next step.' }
        : event.type === 'promoted'
        ? { id: nextId++, severe: false, good: true, title: 'New standing', text: `The board now knows you as ${event.title}.` }
        : event.type === 'pointEarned'
        ? { id: nextId++, severe: false, good: true, opens: 'skills', title: 'Skill point', text: event.free === 1 ? 'You have a point to spend. Open Skills.' : `You have ${event.free} points to spend. Open Skills.` }
        : event.type === 'moduleGained'
        ? { id: nextId++, severe: false, good: true, opens: 'workbench' as const, title: 'New module', text: `${event.name} is on your Workbench shelf.` }
        : event.type !== 'disconnected'
        ? { id: nextId++, severe: false, title: '', text: '' }
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
        alert.severe ? SHOW_SEVERE_MS : isCalm(alert) ? SHOW_CALM_MS : SHOW_MS,
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
          class={`alert${alert.severe ? ' alert--severe' : ''}${alert.good ? ' alert--good' : ''}${alert.chorus ? ' alert--chorus' : ''}${isCalm(alert) ? ' alert--calm' : ''}`}
          title={alert.opens ? 'Open it' : 'Dismiss'}
          onClick={() => {
            if (alert.opens === 'contract') deskStore.showContract(true);
            else if (alert.opens === 'workbench') {
              deskStore.showPrograms('workbench');
              windows.focus('programs');
            } else if (alert.opens) windows.focus(alert.opens);
            setAlerts((list) => list.filter((item) => item.id !== alert.id));
          }}
        >
          <span class="alert__mark" aria-hidden="true">
            {alert.opens === 'skills' ? '◆' : alert.opens === 'workbench' ? '✚' : alert.chorus ? '∴' : alert.good ? '▲' : '!'}
          </span>
          <span class="alert__title">{alert.title}</span>
          <span class="alert__text">{alert.text}</span>
        </button>
      ))}
    </div>
  );
}
