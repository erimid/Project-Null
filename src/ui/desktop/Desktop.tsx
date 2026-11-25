import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { PhoneDock } from './PhoneDock';
import { useLayout } from './layout';
import { useEffect, useRef } from 'preact/hooks';
import { mostUrgentTrace } from '../../core';
import { useGame } from '../hooks';
import type { Speed } from '../../core';
import { content, session } from '../session';
import { Alerts } from './Alerts';
import { CaughtMoment } from './CaughtMoment';
import { StoryMoment } from './StoryMoment';
import { CHORUS_ID } from '../../content';
import { ContractPanel } from './ContractPanel';
import { deskLayout } from './deskLayout';
import { SnapPreview } from './snapStore';
import { TouchTips } from './TouchTips';
import { HoverTips } from './HoverTips';
import { GuideCard } from './GuideCard';
import { JobReport } from './JobReport';
import { Tour } from './Tour';
import { windows } from './windowStore';
import { BrowserWindow } from './windows/BrowserWindow';
import { GatewayWindow } from './windows/GatewayWindow';
import { MapWindow } from './windows/MapWindow';
import { MessagesWindow } from './windows/MessagesWindow';
import { ProgramsWindow } from './windows/ProgramsWindow';
import { SkillsWindow } from './windows/SkillsWindow';
import { ViewerWindow } from './windows/ViewerWindow';
import { SavesWindow } from './windows/SavesWindow';
import { ServerWindow } from './windows/ServerWindow';
import { DefenceWindow } from './windows/DefenceWindow';
import './desktop.css';
import './tutorial.css';
import './stage5.css';
import './layouts.css';
import './world.css';
import './wide.css';
import './globe.css';
import './story.css';
import './feedback.css';
import './record.css';
import './designs.css';
import { DockFrame, DockNav } from './DockFrame';
import { useDockDesign } from './dockStore';
import { look, useLook } from './lookStore';
import { LookSwitch } from './LookSwitch';

const SPEED_KEYS: Readonly<Record<string, Speed>> = { '1': 1, '2': 2, '3': 4 };

/** The card desktop: server tabs on top, floating windows, bottom bar. */
export function Desktop() {
  useEffect(() => {
    // The speed to go back to when Space ends a pause.
    let resumeSpeed: Speed = 1;
    const onKey = (event: KeyboardEvent) => {
      // The panic key: Shift+Esc drops every connection at once.
      if (event.key === 'Escape' && event.shiftKey) {
        event.preventDefault();
        session.dispatch({ type: 'disconnectAll' });
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const current = session.getState().clock.speed;
      if (event.key === ' ') {
        // Also stops Space from pressing whichever button was clicked last.
        event.preventDefault();
        if (current !== 0) resumeSpeed = current;
        session.dispatch({ type: 'setSpeed', speed: current === 0 ? resumeSpeed : 0 });
      } else if (event.key in SPEED_KEYS) {
        session.dispatch({ type: 'setSpeed', speed: SPEED_KEYS[event.key]! });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const layoutKind = useLayout();
  const phone = layoutKind !== 'desk';
  const tracing = useGame((game) => mostUrgentTrace(game, content) !== undefined);
  // An attack opens the Defence window by itself, and closes it again once it is over.
  const underAttack = useGame((game) => game.raid !== null);
  const byChorus = useGame((game) => game.raid?.attackerId === CHORUS_ID);
  useEffect(() => {
    if (underAttack) windows.focus('defence');
    else windows.close('defence');
  }, [underAttack]);
  // Windows are kept on the desk, so it reports its size whenever that changes.
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => {
    const area = workspace.current;
    if (phone || !area) return;
    const report = () => windows.setArea({ w: area.clientWidth, h: area.clientHeight });
    report();
    const watch = new ResizeObserver(report);
    watch.observe(area);
    return () => watch.disconnect();
  }, [phone]);
  // The desk follows the work: Run when the first connection opens, and back when the last one closes.
  const connections = useGame((game) => game.connections.length);
  const lastConnections = useRef(connections);
  // A docked design (see dock.ts) has no layouts to switch: the server's tab comes to the front instead.
  const dockDesign = useDockDesign();
  const floating = useLook().floating;
  useEffect(() => {
    const before = lastConnections.current;
    lastConnections.current = connections;
    if (phone) return;
    if (dockDesign) {
      if (before === 0 && connections > 0) {
        windows.focus('programs');
        windows.focus('server');
      }
      return;
    }
    if (before === 0 && connections > 0) deskLayout.connected();
    else if (before > 0 && connections === 0) deskLayout.disconnected();
  }, [connections, phone, dockDesign]);
  // Changing design: a docked one starts with the map and the working window in front, and
  // the classic desk is laid out afresh, since docked designs leave its windows where they were.
  const lastDesign = useRef<typeof dockDesign | undefined>(undefined);
  useEffect(() => {
    const before = lastDesign.current;
    lastDesign.current = dockDesign;
    if (before === dockDesign) return;
    if (dockDesign) {
      windows.focus(session.getState().connections.length > 0 ? 'programs' : 'messages');
      windows.focus('map');
      windows.focus(session.getState().connections.length > 0 ? 'server' : 'gateway');
      // A window pulled out and then put away some other way goes back to its pane.
      const shown = windows.get();
      for (const id of floating) if (dockDesign !== 'hybrid' || !shown[id].open || shown[id].minimized) look.dock(id);
    } else if (before && !phone) {
      deskLayout.show(deskLayout.get().current === 'run' && session.getState().connections.length === 0 ? 'plan' : deskLayout.get().current);
    }
  }, [dockDesign, phone]);
  const oneBar = dockDesign === 'cards' || dockDesign === 'hybrid';
  // The whole desk jolts when a trace cuts the line.
  const desk = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      session.subscribeEvents((event) => {
        if (event.type !== 'disconnected' || !event.traced) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const shake = ['-7px, 3px', '6px, -4px', '-4px, 2px', '3px, -1px', '0, 0'];
        desk.current?.animate(
          shake.map((offset) => ({ transform: `translate(${offset})` })),
          { duration: 450 },
        );
      }),
    [],
  );

  return (
    <div ref={desk} data-design={dockDesign ?? 'classic'} class={`desktop${dockDesign ? ' desktop--dock' : ''}${phone ? ' desktop--phone' : ''}${layoutKind === 'tablet' ? ' desktop--tablet' : ''}${tracing ? ' is-tracing' : ''}${underAttack ? ' is-attacked' : ''}${byChorus ? ' is-chorus' : ''}`}>
      {oneBar ? <BottomBar docked top middle={<TopBar />} /> : <TopBar />}
      {dockDesign && <DockNav />}
      <main ref={workspace} class="workspace">
        {layoutKind === 'phone' && <p class="workspace__empty">Pick a window below.</p>}
        <GatewayWindow />
        <MapWindow />
        <ServerWindow />
        <ProgramsWindow />
        <MessagesWindow />
        <SkillsWindow />
        <BrowserWindow />
        <ViewerWindow />
        <SavesWindow />
        <DefenceWindow />
        <ContractPanel />
        <DockFrame />
        {layoutKind === 'desk' && <SnapPreview />}
        <Alerts />
        <JobReport />
        <TouchTips />
        <HoverTips />
      </main>
      {phone ? <PhoneDock /> : oneBar ? null : <BottomBar docked={dockDesign !== null} />}
      <LookSwitch />
      {phone && <GuideCard />}
      <Tour />
      <CaughtMoment />
      <StoryMoment />
    </div>
  );
}
