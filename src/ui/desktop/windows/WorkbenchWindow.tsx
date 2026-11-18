import { useState } from 'preact/hooks';
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

  return (
    <Window id="workbench" note={`${slots} ${slots === 1 ? 'module' : 'modules'} per build`}>
      <h3 class="map__heading">Build</h3>
      {running ? (
        <div class="bench__running">
          <span>Building {findProgram(content, running.programId)?.name}</span>
          <TaskProgress taskId={running.id} label="Building" />
        </div>
      ) : null}
      <p class="bench__step">1. A program you own</p>
      <div class="bench__chips">
        {bases.map((program) => (
          <button
            key={program.id}
            type="button"
            class={`chip${program.id === baseId ? ' is-picked' : ''}`}
            aria-pressed={program.id === baseId}
            onClick={() => pickBase(program.id)}
          >
            {program.name} <span class="data">v{program.version}</span>
          </button>
        ))}
      </div>
      <p class="bench__step">2. {slots === 1 ? 'A module' : `Up to ${slots} modules`}</p>
      {parts.length === 0 ? (
        <p class="empty">You have no modules yet.</p>
      ) : (
        <div class="bench__chips">
          {parts.map(([module, grade, count]) => {
            const fits = !base || module.fits.includes(base.kind);
            const on = chosen.some((item) => item.id === module.id && item.grade === grade);
            return (
              <button
                key={`${module.id}:${grade}`}
                type="button"
                class={`chip chip--module${on ? ' is-picked' : ''}`}
                disabled={!base || !fits}
                title={base && !fits ? `${module.name} does nothing for a ${base.name}.` : module.blurb}
                aria-pressed={on}
                onClick={() => toggle({ id: module.id, grade })}
              >
                {module.name} {grade} <span class="data row__dim">×{count}</span>
              </button>
            );
          })}
        </div>
      )}
      {base && check?.ok && timed?.ok ? (
        <div class="bench__preview">
          <span>
            <strong>{check.preview.name}</strong>
          </span>
          <span class="data">
            {seconds(base.baseSeconds)} → {seconds(check.preview.baseSeconds)} base time · {base.sizeGq} → {check.preview.sizeGq} GB
            {check.preview.traits.length > 0 ? ` · ${check.preview.traits.join(', ')}` : ''}
          </span>
          <button type="button" class="btn btn--go" disabled={!!running} onClick={build}>
            Build · {seconds(timed.seconds)}
          </button>
        </div>
      ) : base && check && !check.ok ? (
        <p class="map__notice">{check.reason}</p>
      ) : null}

      <h3 class="map__heading section-gap">Modules on hand</h3>
      {parts.length === 0 ? (
        <p class="empty">Modules come from contacts, contracts and the market.</p>
      ) : (
        <ul class="rows">
          {parts.map(([module, grade, count]) => (
            <li key={`${module.id}:${grade}`} class="row row--program">
              <span class="row__main">
                <strong>
                  {module.name} {grade}
                </strong>{' '}
                <span class="data row__dim">×{count}</span>
                <span class="program__blurb">{module.blurb}</span>
              </span>
              {canRefine && grade < module.grades.length ? (
                <button
                  type="button"
                  class="btn"
                  disabled={count < 2}
                  title={count < 2 ? 'Refining takes two of the same.' : `Two ${module.name} ${grade} into one ${module.name} ${grade + 1}`}
                  onClick={() => act(session.dispatch({ type: 'refineModule', moduleId: module.id, grade }))}
                >
                  Refine
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3 class="map__heading section-gap">Your builds</h3>
      {game.player.builds.length === 0 ? (
        <p class="empty">Nothing built yet.</p>
      ) : (
        <ul class="rows">
          {game.player.builds.map((item) => {
            const program = findProgram(content, item.id, game);
            if (!program) return null;
            const inUse = ownedProgram(game, content, program.kind)?.id === program.id;
            return (
              <li key={item.id} class="row row--program">
                <span class="row__main">
                  <strong>{program.name}</strong> <span class="data row__dim">v{program.version}</span>
                  <span class="program__blurb">
                    {item.modules.map((fitted) => findModule(content, fitted.id)?.name).join(' and ')} fitted
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
