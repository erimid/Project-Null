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
  topVersion,
  type Fitted,
  type GameState,
} from '../../../core';
import type { ModuleDef } from '../../../core/content';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { IconTile, ModulePlate, Pips, TRAIT_WORDS } from '../Gear';
import { Icon, kindLabel, moduleIcon, programIcon } from '../Icon';
import { TaskProgress } from '../TaskProgress';
import { Window } from '../Window';
import { gradeEffect } from './MarketSection';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const seconds = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}s`;

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

/** Something a build does or does not do, before and after: stealth, log lines, the program slot. */
function Change({ label, before, after, gained }: { label: string; before: string; after: string; gained: boolean }) {
  return (
    <div class={`gauge gauge--words${gained ? ' is-better' : ''}`}>
      <span class="gauge__label">{label}</span>
      <span class="gauge__figures gauge__figures--words">
        {before} <span class="gauge__arrow">›</span> <strong>{gained ? after : 'no change'}</strong>
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

  const unfit = (item: Fitted) => {
    setNotice('');
    setChosen(chosen.filter((other) => !(other.id === item.id && other.grade === item.grade)));
  };
  const gains = (trait: string) => !!check?.ok && (check.preview.traits as readonly string[]).includes(trait);

  return (
    <Window id="workbench" note={`${slots} ${slots === 1 ? 'module' : 'modules'} per build`}>
      <div class="wb">
        <aside class="wb__programs">
          <p class="bench__step">1. Pick a program</p>
          <ul class="wb__list">
            {bases.map((program) => (
              <li key={program.id}>
                <button
                  type="button"
                  class={`wb__prog${program.id === baseId ? ' is-picked' : ''}`}
                  aria-pressed={program.id === baseId}
                  disabled={!!running}
                  data-tip={`${kindLabel(program.kind)}. Put it on the bench to fit modules to a copy of it.`}
                  data-sfx="pick"
                  onClick={() => pickBase(program.id)}
                >
                  <Icon name={programIcon(program.kind)} size={18} />
                  <span class="wb__prog-name">{program.name}</span>
                  <span class="data wb__prog-version">v{program.version}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div class="wb__main">
          <div class={`bench${running ? ' is-building' : ''}${benchBase ? ' has-program' : ''}`}>
            <div class={`rig rig--${slots}`}>
              <div class={`rig__program${benchBase ? ' is-filled' : ''}`}>
                <IconTile icon={benchBase ? programIcon(benchBase.kind) : 'terminal'} size="lg" tone={benchBase ? undefined : 'empty'} />
                {benchBase ? (
                  <span class="rig__text">
                    <span class="bench__tag">On the bench</span>
                    <strong>{benchBase.name}</strong>
                    <span class="rig__meta">
                      <span class="data">v{benchBase.version}</span>
                      <Pips on={benchBase.version} of={topVersion(content, benchBase.kind)} label={`version ${benchBase.version}`} />
                      <span class="data">{benchBase.sizeGq} GB</span>
                    </span>
                  </span>
                ) : (
                  <span class="rig__text">
                    <span class="bench__tag">The bench</span>
                    <span class="bench__hint">Pick a program to put on it.</span>
                  </span>
                )}
              </div>
              <div class="rig__sockets">
                {Array.from({ length: slots }, (_, index) => {
                  const item = fitted[index];
                  const module = item && findModule(content, item.id);
                  return module && item ? (
                    <button
                      key={index}
                      type="button"
                      class={`socket is-filled bench__slot--${module.id}`}
                      disabled={!!running}
                      data-tip="Click to take this module back out"
                      data-sfx="unsocket"
                      onClick={() => unfit(item)}
                    >
                      <IconTile icon={moduleIcon(module.id)} tone={module.id} size="sm" />
                      <span class="socket__text">
                        <span class="bench__tag">{slots === 1 ? 'Socket' : `Socket ${index + 1}`}</span>
                        <ModulePlate module={module} grade={item.grade} icon={false} />
                      </span>
                    </button>
                  ) : (
                    <div key={index} class="socket">
                      <span class="socket__hole" aria-hidden="true" />
                      <span class="socket__text">
                        <span class="bench__tag">{slots === 1 ? 'Socket' : `Socket ${index + 1}`}</span>
                        <span class="bench__hint">{base ? 'Click a module below' : 'Empty'}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {running ? (
              <div class="bench__result is-building">
                <strong>Building…</strong>
                <TaskProgress taskId={running.id} label="Building" />
              </div>
            ) : base && check?.ok && timed?.ok ? (
              <div class="bench__result">
                <strong class="bench__name">{check.preview.name}</strong>
                <Gauge label="Time" before={base.baseSeconds} after={check.preview.baseSeconds} unit="s" lowerIsBetter />
                <Gauge label="Size" before={base.sizeGq} after={check.preview.sizeGq} unit="GB" lowerIsBetter />
                <Change label="Stealth" before="Monitors see it" after="Monitors do not" gained={gains('quiet')} />
                {gains('tidy') && <Change label="Log" before="Leaves a line" after="Leaves none" gained />}
                {gains('parallel') && <Change label="Slot" before="Uses one" after="Uses none" gained />}
                <button type="button" class="btn btn--go bench__go" onClick={build}>
                  Build · <span class="data">{seconds(timed.seconds)}</span>
                </button>
              </div>
            ) : base && check && !check.ok ? (
              <p class="map__notice">{check.reason}</p>
            ) : base && timed && !timed.ok ? (
              <p class="map__notice">{timed.reason}</p>
            ) : (
              <p class="bench__prompt">
                {base ? 'Now click a module in the tray to socket it.' : 'Pick a program, socket a module, build. Your original stays as it is.'}
              </p>
            )}
          </div>

          <p class="bench__step">
            2. Parts tray <span class="heading__note">{base ? `click a module to socket it into ${base.name}` : 'pick a program first'}</span>
          </p>
          {parts.length === 0 ? (
            <p class="empty">You have no modules yet. They come from contacts, contracts, servers and the market.</p>
          ) : (
            <ul class="bench__shelf">
              {parts.map(([module, grade, count]) => {
                const fits = !base || module.fits.includes(base.kind);
                const on = chosen.some((item) => item.id === module.id && item.grade === grade);
                const figures = module.grades[grade - 1];
                return (
                  <li key={`${module.id}:${grade}`} class={`part part--${module.id}${on ? ' is-picked' : ''}${base && !fits ? ' is-unfit' : ''}`}>
                    <button
                      type="button"
                      class="part__pick chip--module"
                      disabled={!base || !fits || !!running}
                      title={base && !fits ? `${module.name} does nothing for a ${base.name}.` : undefined}
                      data-tip={module.blurb}
                      aria-pressed={on}
                      data-sfx={on ? 'unsocket' : 'socket'}
                      onClick={() => toggle({ id: module.id, grade })}
                    >
                      <IconTile icon={moduleIcon(module.id)} tone={module.id} size="sm" />
                      <span class="part__text">
                        <ModulePlate module={module} grade={grade} count={count} icon={false} />
                        <span class="part__blurb">
                          {capital(`${figures ? gradeEffect(figures) : ''}${module.trait ? `. ${TRAIT_WORDS[module.trait]}` : ''}`)}
                        </span>
                      </span>
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
        </div>
      </div>

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
