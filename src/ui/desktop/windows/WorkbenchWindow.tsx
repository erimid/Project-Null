import { useEffect, useRef, useState } from 'preact/hooks';
import {
  buildBases,
  checkBuild,
  checkTask,
  effect,
  findModule,
  findProgram,
  moduleSlots,
  ownedProgram,
  type Fitted,
  type GameState,
} from '../../../core';
import type { ModuleDef } from '../../../core/content';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { TaskProgress } from '../TaskProgress';
import { Window } from '../Window';

const seconds = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}s`;

/** What a trait does, in the fewest words. */
const TRAITS: Record<string, string> = { quiet: 'Monitors do not notice it', tidy: 'Leaves no line in the log' };

/** A module as a small plate: its colour, its name, a pip for each grade. */
function ModulePlate({ module, grade, count }: { module: ModuleDef; grade: number; count?: number }) {
  return (
    <span class={`plate plate--${module.id}`}>
      <span class="plate__name">{module.name}</span>
      <span class="plate__grade" aria-label={`grade ${grade}`}>
        {module.grades.map((_, index) => (
          <i key={index} class={index < grade ? 'is-on' : ''} />
        ))}
      </span>
      {count !== undefined && <span class="plate__count data">×{count}</span>}
    </span>
  );
}

/** One figure before and after a build, with a bar for each and the change in colour. */
function Gauge({ label, before, after, unit, lowerIsBetter }: { label: string; before: number; after: number; unit: string; lowerIsBetter: boolean }) {
  const most = Math.max(before, after, 0.001);
  const better = lowerIsBetter ? after < before : after > before;
  const same = Math.abs(after - before) < 0.05;
  const show = (value: number) => (unit === 's' ? seconds(value) : `${value} ${unit}`);
  return (
    <div class={`gauge${same ? '' : better ? ' is-better' : ' is-worse'}`}>
      <span class="gauge__label">{label}</span>
      <span class="gauge__bars" aria-hidden="true">
        <i class="gauge__was" style={{ width: `${(100 * before) / most}%` }} />
        <i class="gauge__now" style={{ width: `${(100 * after) / most}%` }} />
      </span>
      <span class="gauge__figures data">
        {show(before)} <span class="gauge__arrow">›</span> <strong>{show(after)}</strong>
      </span>
    </div>
  );
}

/** Modules on hand, as [module, grade, count], in the order modules.json lists them. */
function shelf(game: GameState): [ModuleDef, number, number][] {
  const rows: [ModuleDef, number, number][] = [];
  for (const module of content.modules) {
    module.grades.forEach((_, index) => {
      const count = game.player.parts[`${module.id}:${index + 1}`] ?? 0;
      if (count > 0) rows.push([module, index + 1, count]);
    });
  }
  return rows;
}

/**
 * The Workbench: pick a program you own, fit modules from your shelf, and
 * build. Below, the modules on hand (and refining, with the skill) and
 * the programs you have built.
 */
export function WorkbenchWindow() {
  const game = useWorld((state) => state);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Fitted[]>([]);
  const [notice, setNotice] = useState('');
  const bases = buildBases(game, content);
  const base = bases.find((program) => program.id === baseId) ?? null;
  const slots = moduleSlots(game, content);
  const parts = shelf(game);
  const running = game.tasks.find((task) => task.target.kind === 'build');
  const canRefine = effect(game, content, 'refine') > 0;

  const pickBase = (id: string) => {
    setBaseId(id === baseId ? null : id);
    setChosen([]);
    setNotice('');
  };
  const toggle = (fitted: Fitted) => {
    setNotice('');
    const on = chosen.some((item) => item.id === fitted.id && item.grade === fitted.grade);
    if (on) return setChosen(chosen.filter((item) => !(item.id === fitted.id && item.grade === fitted.grade)));
    // Picking another grade of the same module swaps it; a full build drops the oldest pick.
    const others = chosen.filter((item) => item.id !== fitted.id);
    setChosen([...others, fitted].slice(-slots));
  };
  const check = base && chosen.length > 0 ? checkBuild(game, content, base.id, chosen) : null;
  const timed = base && chosen.length > 0 ? checkTask(game, content, null, { kind: 'build', base: base.id, modules: chosen }) : null;
  const build = () => {
    if (!base) return;
    const result = session.dispatch({ type: 'buildProgram', base: base.id, modules: chosen });
    setNotice(result.ok ? '' : result.reason);
    if (result.ok) setChosen([]);
  };
  const act = (result: { ok: boolean; reason?: string }) => setNotice(result.ok ? '' : (result.reason ?? ''));
  // A build that finishes while the window is open lights its row up once.
  const known = useRef(new Set(game.player.builds.map((item) => item.id)));
  const buildIds = game.player.builds.map((item) => item.id).join(' ');
  useEffect(() => {
    const timer = setTimeout(() => (known.current = new Set(buildIds.split(' '))), 1400);
    return () => clearTimeout(timer);
  }, [buildIds]);
  const fitted = running && running.target.kind === 'build' ? running.target.modules : chosen;
  const benchBase = running && running.target.kind === 'build' ? (content.programs.find((program) => program.id === (running.target as { base: string }).base) ?? null) : base;

  return (
    <Window id="workbench" note={`${slots} ${slots === 1 ? 'module' : 'modules'} per build`}>
      <div class={`bench${running ? ' is-building' : ''}`}>
        <div class="bench__line">
          <div class={`bench__slot bench__slot--program${benchBase ? ' is-filled' : ''}`}>
            <span class="bench__tag">Program</span>
            {benchBase ? (
              <strong>
                {benchBase.name} <span class="data">v{benchBase.version}</span>
              </strong>
            ) : (
              <span class="bench__hint">Pick one below</span>
            )}
          </div>
          {Array.from({ length: slots }, (_, index) => {
            const item = fitted[index];
            const module = item && findModule(content, item.id);
            return (
              <span key={index} class="bench__pair">
                <span class="bench__plus" aria-hidden="true">
                  +
                </span>
                <div class={`bench__slot${module ? ` is-filled bench__slot--${module.id}` : ''}`}>
                  <span class="bench__tag">{slots === 1 ? 'Module' : `Module ${index + 1}`}</span>
                  {module && item ? <ModulePlate module={module} grade={item.grade} /> : <span class="bench__hint">Empty</span>}
                </div>
              </span>
            );
          })}
        </div>
        {running ? (
          <div class="bench__result is-building">
            <strong>Building…</strong>
            <TaskProgress taskId={running.id} label="Building" />
          </div>
        ) : base && check?.ok && timed?.ok ? (
          <div class="bench__result">
            <strong class="bench__name">{check.preview.name}</strong>
            <Gauge label="Base time" before={base.baseSeconds} after={check.preview.baseSeconds} unit="s" lowerIsBetter />
            <Gauge label="Room" before={base.sizeGq} after={check.preview.sizeGq} unit="GB" lowerIsBetter />
            {check.preview.traits.map((trait) => (
              <span key={trait} class={`bench__trait bench__trait--${trait}`}>
                <b>{trait}</b> {TRAITS[trait]}
              </span>
            ))}
            <button type="button" class="btn btn--go bench__go" onClick={build}>
              Build · <span class="data">{seconds(timed.seconds)}</span>
            </button>
          </div>
        ) : base && check && !check.ok ? (
          <p class="map__notice">{check.reason}</p>
        ) : (
          <p class="bench__prompt">
            {base ? 'Now pick a module to fit.' : 'Pick a program, fit a module, build. Your original stays as it is.'}
          </p>
        )}
      </div>

      <p class="bench__step">Programs you own</p>
      <div class="bench__chips">
        {bases.map((program) => (
          <button
            key={program.id}
            type="button"
            class={`chip${program.id === baseId ? ' is-picked' : ''}`}
            aria-pressed={program.id === baseId}
            disabled={!!running}
            onClick={() => pickBase(program.id)}
          >
            {program.name} <span class="data">v{program.version}</span>
          </button>
        ))}
      </div>

      <h3 class="map__heading section-gap">
        Modules on hand <span class="heading__note">{base ? `click to fit to ${base.name}` : 'pick a program first'}</span>
      </h3>
      {parts.length === 0 ? (
        <p class="empty">You have no modules yet. They come from contacts, contracts, servers and the market.</p>
      ) : (
        <ul class="bench__shelf">
          {parts.map(([module, grade, count]) => {
            const fits = !base || module.fits.includes(base.kind);
            const on = chosen.some((item) => item.id === module.id && item.grade === grade);
            return (
              <li key={`${module.id}:${grade}`} class={`part part--${module.id}${on ? ' is-picked' : ''}${base && !fits ? ' is-unfit' : ''}`}>
                <button
                  type="button"
                  class="part__pick chip--module"
                  disabled={!base || !fits || !!running}
                  title={base && !fits ? `${module.name} does nothing for a ${base.name}.` : undefined}
                  aria-pressed={on}
                  onClick={() => toggle({ id: module.id, grade })}
                >
                  <ModulePlate module={module} grade={grade} count={count} />
                  <span class="part__blurb">{module.blurb}</span>
                </button>
                {canRefine && grade < module.grades.length ? (
                  <button
                    type="button"
                    class="btn part__refine"
                    disabled={count < 2}
                    title={count < 2 ? 'Refining takes two of the same.' : `Two ${module.name} ${grade} into one ${module.name} ${grade + 1}`}
                    onClick={() => act(session.dispatch({ type: 'refineModule', moduleId: module.id, grade }))}
                  >
                    Refine
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h3 class="map__heading section-gap">Your builds</h3>
      {game.player.builds.length === 0 ? (
        <p class="empty">Nothing built yet.</p>
      ) : (
        <ul class="rows">
          {game.player.builds.map((item) => {
            const program = findProgram(content, item.id, game);
            const origin = content.programs.find((other) => other.id === item.base);
            if (!program) return null;
            const inUse = ownedProgram(game, content, program.kind)?.id === program.id;
            return (
              <li key={item.id} class={`row row--build${known.current.has(item.id) ? '' : ' is-new'}${inUse ? ' is-used' : ''}`}>
                <span class="row__main">
                  <strong>{origin?.name ?? program.name}</strong> <span class="data row__dim">v{program.version}</span>
                  <span class="build__plates">
                    {item.modules.map((fit) => {
                      const module = findModule(content, fit.id);
                      return module ? <ModulePlate key={fit.id} module={module} grade={fit.grade} /> : null;
                    })}
                  </span>
                </span>
                <span class="data row__dim">{program.sizeGq} GB</span>
                {inUse ? (
                  <span class="row__done">In use</span>
                ) : (
                  <button type="button" class="btn" onClick={() => act(session.dispatch({ type: 'preferProgram', programId: item.id }))}>
                    Use
                  </button>
                )}
                <ConfirmButton
                  class="btn btn--danger"
                  confirmLabel="Scrap?"
                  onConfirm={() => act(session.dispatch({ type: 'scrapProgram', programId: item.id }))}
                >
                  Scrap
                </ConfirmButton>
              </li>
            );
          })}
        </ul>
      )}
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </Window>
  );
}
