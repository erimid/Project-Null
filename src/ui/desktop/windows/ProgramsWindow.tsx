import { useState } from 'preact/hooks';
import {
  LOADOUT_SLOTS,
  TWISTS,
  findModule,
  twistOn,
  freeMemoryGb,
  isLoaded,
  loadedPrograms,
  loadoutLocked,
  matchesLoadout,
  memoryGb,
  needsMemory,
  whyNotLoad,
  findProgram,
  findServer,
  hostedModel,
  installedOfKind,
  maxPrograms,
  moduleSlots,
  programFile,
  programStorageGq,
  rackStorageGb,
  storageGb,
  topVersion,
  usedStorageGq,
  type GameState,
} from '../../../core';
import type { ProgramDef } from '../../../core/content';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { FileName } from '../FileName';
import { IconTile, ModulePlate, Pips } from '../Gear';
import { Icon, PROGRAM_GROUPS, fileIcon, kindLabel, programIcon } from '../Icon';
import { TaskProgress, describeTarget, findTask } from '../TaskProgress';
import { viewer } from '../viewerStore';
import { Window } from '../Window';
import { deskStore, useDesk } from '../deskStore';
import { WorkbenchSection } from './WorkbenchSection';

/** One installed program as a tile: its icon, version and size, whether it is in memory or running, and what can be done with it. */
function ProgramTile({ game, program }: { game: GameState; program: ProgramDef }) {
  const build = game.player.builds.find((item) => item.id === program.id);
  const running = game.tasks.some((task) => task.programId === program.id);
  const field = needsMemory(program.kind);
  const loaded = field && isLoaded(game, program.id);
  const locked = loadoutLocked(game, content);
  const blocked = field && !loaded ? whyNotLoad(game, content, program.id) : null;
  // A crafted program keeps the name and the top version of the one it was built from.
  const base = build ? content.programs.find((item) => item.id === build.base) : undefined;
  return (
    <li class={`ptile${running ? ' is-running' : ''}${loaded ? ' is-used' : ''}${field && !loaded ? ' is-spare' : ''}`} data-tip={program.blurb}>
      <IconTile icon={programIcon(program.kind)} tone={running ? 'good' : undefined} />
      <div class="ptile__text">
        <strong>{base?.name ?? program.name}</strong>
        <span class="ptile__meta">
          <span class="data">v{program.version}</span>
          <Pips on={program.version} of={topVersion(content, program.kind)} label={`version ${program.version}`} />
          <span class="data ptile__size">{program.sizeGq} GB</span>
        </span>
        {build && (
          <span class="build__plates">
            {build.modules.map((fit) => {
              const module = findModule(content, fit.id);
              return module ? <ModulePlate key={fit.id} module={module} grade={fit.grade} /> : null;
            })}
          </span>
        )}
      </div>
      <div class="ptile__actions">
        {running ? (
          <span class="ptile__state is-running">
            <i class="ptile__beat" aria-hidden="true" /> Running
          </span>
        ) : !field ? (
          <span class="ptile__state is-home" data-tip="Runs at home, straight off the drive. It needs no memory.">
            <Icon name="drives" size={14} /> Runs at home
          </span>
        ) : loaded ? (
          <button
            type="button"
            class="btn ptile__load is-loaded"
            data-sfx="unload"
            disabled={locked}
            data-tip={locked ? 'Memory is locked while you are inside a server.' : 'In memory, ready to run on a job. Click to take it out and free the room.'}
            onClick={() => session.dispatch({ type: 'unloadProgram', programId: program.id })}
          >
            <Icon name="check" size={14} /> Loaded
          </button>
        ) : (
          <button
            type="button"
            class="btn btn--go ptile__load"
            data-sfx="load"
            disabled={blocked !== null}
            data-tip={blocked ?? 'Load it into memory so it can run on a job. It takes the place of any other of its kind.'}
            onClick={() => session.dispatch({ type: 'loadProgram', programId: program.id })}
          >
            Load
          </button>
        )}
        {!running && (
          <ConfirmButton
            class="btn btn--danger"
            confirmLabel={build ? 'Scrap?' : 'Remove?'}
            tip={build ? 'Take this build apart. You get its modules and the plain program back.' : 'Uninstall to free storage. The market gives it back if you need it.'}
            onConfirm={() => session.dispatch({ type: 'uninstallProgram', programId: program.id })}
          >
            {build ? 'Scrap' : 'Remove'}
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}

/**
 * Memory: what is loaded for the next job, as a bar with one block per
 * program, and the three kits a loadout can be kept in.
 */
function MemoryPanel({ game }: { game: GameState }) {
  const capacity = memoryGb(game, content);
  const loaded = loadedPrograms(game, content);
  const free = freeMemoryGb(game, content);
  const locked = loadoutLocked(game, content);
  const [notice, setNotice] = useState('');
  const send = (action: Parameters<typeof session.dispatch>[0]) => {
    const result = session.dispatch(action);
    setNotice(result.ok ? '' : result.reason);
  };
  if (!Number.isFinite(capacity)) return null;
  return (
    <div class={`drive memory${locked ? ' is-locked' : ''}`} data-guide="memory">
      <div class="drive__head">
        <Icon name="ram" size={18} />
        <strong>Memory</strong>
        <span class="data drive__used">
          {capacity - free} of {capacity} GB
        </span>
        {locked && (
          <span class="memory__lock" data-tip="What you loaded is what you have until you disconnect.">
            <Icon name="lock" size={13} /> Locked while connected
          </span>
        )}
        {twistOn(game, 'travelLight') && (
          <span class="memory__lock" data-tip={TWISTS.travelLight.line}>
            <Icon name="sparkle" size={13} /> Travel light
          </span>
        )}
        <span class="data drive__free">{free} GB free</span>
      </div>
      <div class="memory__bar" role="img" aria-label={`In memory: ${loaded.map((program) => `${program.name} ${program.sizeGq} GB`).join(', ') || 'nothing'}. ${free} GB free.`}>
        {loaded.map((program) => (
          <span key={program.id} class="memory__block" style={{ flexGrow: program.sizeGq }} data-tip={`${program.name} v${program.version} · ${program.sizeGq} GB`}>
            <Icon name={programIcon(program.kind)} size={14} />
          </span>
        ))}
        {free > 0 && <span class="memory__block memory__block--free" style={{ flexGrow: free }} />}
      </div>
      <p class="memory__note">Only what is loaded here runs on a job. Load before you connect: memory locks while you are inside a server.</p>
      <div class="memory__kits">
        <button type="button" class="btn" disabled={locked} data-tip="Load the strongest program of each kind, for as long as they fit" onClick={() => send({ type: 'packMemory' })}>
          Pack the best
        </button>
        {Array.from({ length: LOADOUT_SLOTS }, (_, slot) => {
          const saved = (game.player.savedLoadouts[slot] ?? []).map((id) => findProgram(content, id, game)).filter((program): program is ProgramDef => program !== undefined);
          const current = matchesLoadout(game, content, slot);
          const names = saved.map((program) => `${program.name} v${program.version}`).join(', ');
          return (
            <span key={slot} class={`kit${current ? ' is-current' : ''}${saved.length === 0 ? ' is-empty' : ''}`}>
              <button
                type="button"
                class="btn kit__use"
                disabled={locked || saved.length === 0 || current}
                data-tip={saved.length === 0 ? 'Nothing kept here yet. Save what is loaded with the button beside this one.' : current ? `This kit is what is loaded now: ${names}` : `Load this kit: ${names}`}
                onClick={() => send({ type: 'useLoadout', slot })}
              >
                Kit {slot + 1}
                <span class="data kit__count">{saved.length === 0 ? 'empty' : `${saved.reduce((sum, program) => sum + program.sizeGq, 0)} GB`}</span>
              </button>
              <button type="button" class="btn kit__save" disabled={loaded.length === 0 || current} data-tip={`Keep what is loaded now as kit ${slot + 1}`} aria-label={`Save as kit ${slot + 1}`} onClick={() => send({ type: 'saveLoadout', slot })}>
                Save
              </button>
            </span>
          );
        })}
      </div>
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * The Programs window has two sides, picked by the tabs under its title:
 * the programs and files on the gateway, and the Workbench where modules
 * are fitted to them. Both stay drawn, so a half-made build is still on
 * the bench after a look at the drive.
 */
export function ProgramsWindow() {
  const tab = useDesk().programsTab;
  const running = useWorld((game) => `${game.tasks.length} of ${maxPrograms(game, content)} running`);
  const slots = useWorld((game) => moduleSlots(game, content));
  const parts = useWorld((game) => Object.values(game.player.parts).reduce((sum, count) => sum + count, 0));
  return (
    <Window
      id="programs"
      note={tab === 'workbench' ? `workbench · ${slots} ${slots === 1 ? 'module' : 'modules'} per build` : running}
      tabs={
        <>
          <button type="button" class={`tabbtn${tab === 'programs' ? ' is-current' : ''}`} aria-pressed={tab === 'programs'} data-tip="What is installed, what is running, and the files you have brought home" onClick={() => deskStore.showPrograms('programs')}>
            Programs
          </button>
          <button type="button" class={`tabbtn${tab === 'workbench' ? ' is-current' : ''}`} aria-pressed={tab === 'workbench'} data-tip="Fit modules to your programs to make faster, smaller or quieter versions" onClick={() => deskStore.showPrograms('workbench')}>
            Workbench
            {parts > 0 && <span class="count data" aria-label={`${parts} modules on the shelf`}>{parts}</span>}
          </button>
        </>
      }
    >
      <div hidden={tab !== 'programs'}>
        <ProgramsSection />
      </div>
      <div hidden={tab !== 'workbench'}>
        <WorkbenchSection />
      </div>
    </Window>
  );
}

/**
 * The gateway's programs and storage: how the drive is used, what is
 * running, the installed programs as tiles grouped by what they do, and
 * the files brought home.
 */
function ProgramsSection() {
  const game = useWorld((state) => state);
  const capacity = storageGb(game, content);
  const used = usedStorageGq(game, content);
  const byPrograms = programStorageGq(game, content);
  const byModel = rackStorageGb(game, content);
  const model = hostedModel(game, content);
  const byFiles = used - byPrograms - byModel;
  const free = Math.max(0, capacity - used);
  const share = (gb: number) => `${Math.min(100, (gb / Math.max(capacity, used)) * 100)}%`;
  const serverName = (id: string) => findServer(content, id)?.name ?? id;
  const [notice, setNotice] = useState('');
  const decrypt = (name: string) => {
    const result = session.dispatch({ type: 'decryptFile', name });
    setNotice(result.ok ? '' : result.reason);
  };
  const decompile = (name: string) => {
    const result = session.dispatch({ type: 'decompileFile', name });
    setNotice(result.ok ? '' : result.reason);
  };

  return (
    <>
      <div class={`drive${used > capacity ? ' is-over' : ''}`}>
        <div class="drive__head">
          <Icon name="drives" size={18} />
          <strong>Drive</strong>
          <span class="data drive__used">
            {used} of {capacity} GB
          </span>
          <span class="data drive__free">{free} GB free</span>
        </div>
        <div
          class={`storage${used > capacity ? ' is-over' : ''}`}
          role="img"
          aria-label={`Programs ${byPrograms} GB,${model ? ` ${model.name} ${byModel} GB,` : ''} files ${byFiles} GB, free ${free} GB`}
        >
          <span class="storage__part storage__part--programs" style={{ width: share(byPrograms) }} />
          {byModel > 0 && <span class="storage__part storage__part--model" style={{ width: share(byModel) }} />}
          <span class="storage__part storage__part--files" style={{ width: share(byFiles) }} />
        </div>
        <p class="storage__key">
          <span class="storage__dot storage__dot--programs" /> Programs <span class="data">{byPrograms} GB</span>
          {model && (
            <>
              <span class="storage__dot storage__dot--model" /> {model.name} <span class="data">{byModel} GB</span>
            </>
          )}
          <span class="storage__dot storage__dot--files" /> Files <span class="data">{byFiles} GB</span>
        </p>
      </div>
      {used > capacity && (
        <p class="board__warning">Your gateway holds more than its drive is meant to. Nothing new fits until you free some room.</p>
      )}

      <MemoryPanel game={game} />

      <h3 class="map__heading section-gap">
        Running{' '}
        <span class="data heading__note">
          {game.tasks.length} of {maxPrograms(game, content)}
        </span>
      </h3>
      {game.tasks.length === 0 ? (
        <p class="empty">Nothing is running. Programs start from buttons on a server you are connected to.</p>
      ) : (
        <ul class="rows">
          {game.tasks.map((task) => {
            const connection = game.connections.find((item) => item.id === task.connectionId);
            const program = findProgram(content, task.programId, game);
            return (
              <li key={task.id} class="row row--task">
                <span class="row__main runrow">
                  {program && (
                    <span class="runrow__icon">
                      <Icon name={programIcon(program.kind)} size={18} />
                    </span>
                  )}
                  <span>
                    <strong>{program?.name ?? task.programId}</strong>
                    <span class="row__dim"> · {connection ? serverName(connection.serverId) : 'Gateway'}</span>
                  </span>
                </span>
                <TaskProgress taskId={task.id} label={describeTarget(task.target)} />
                <button
                  type="button"
                  class="btn"
                  data-tip="Stop this program. Its progress is lost."
                  onClick={() => session.dispatch({ type: 'cancelProgram', taskId: task.id })}
                >
                  Stop
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3 class="map__heading section-gap">
        Installed programs <span class="data heading__note">{game.player.programs.length}</span>
      </h3>
      {game.player.programs.length === 0 && <p class="empty">No programs installed. The Backroom market has them.</p>}
      {PROGRAM_GROUPS.map((group) => {
        const kinds = group.kinds.map((kind) => ({ kind, list: installedOfKind(game, content, kind) })).filter(({ list }) => list.length > 0);
        if (kinds.length === 0) return null;
        return (
          <section key={group.id} class="progs">
            <p class="progs__group">
              <Icon name={group.icon} size={15} /> {group.label}
            </p>
            <ul class="progs__grid">
              {kinds.map(({ kind, list }) =>
                list.length > 1 && needsMemory(kind) ? (
                  // Several copies of one tool: boxed together, the one in memory lit.
                  <li key={kind} class="kindset">
                    <span class="kindset__label">
                      {kindLabel(kind)}: <b>{list.length} copies</b>. One of a kind fits in memory at a time.
                    </span>
                    <ul class="progs__grid">
                      {list.map((program) => (
                        <ProgramTile key={program.id} game={game} program={program} />
                      ))}
                    </ul>
                  </li>
                ) : (
                  list.map((program) => <ProgramTile key={program.id} game={game} program={program} />)
                ),
              )}
            </ul>
          </section>
        );
      })}

      <h3 class="map__heading section-gap">
        Stored files <span class="data heading__note">{game.player.files.length}</span>
      </h3>
      {game.player.files.length === 0 ? (
        <p class="empty">No files yet. Copy one from a server and it shows up here.</p>
      ) : (
        <ul class="rows rows--scroll">
          {game.player.files.map((file) => {
            const decrypting = findTask(game, null, { kind: 'decrypt', file: file.name });
            const decompiling = findTask(game, null, { kind: 'decompile', file: file.name });
            const isProgram = programFile(game, content, file.name) !== undefined;
            return (
              <li key={file.name} class={`row row--stored${file.encrypted ? ' is-sealed' : ''}`}>
                <span class="row__main data filerow">
                  <span class={`filerow__icon${file.encrypted ? ' is-sealed' : ''}`}>
                    <Icon name={fileIcon(file.name, !!file.encrypted)} size={18} />
                  </span>
                  <span>
                    <FileName name={file.name} />
                    <span class="program__blurb">
                      from {serverName(file.from)}
                      {file.encrypted ? <span class="sealed"> · encrypted, level {file.encrypted}</span> : null}
                      {isProgram ? <span> · a program, can be decompiled</span> : null}
                    </span>
                  </span>
                </span>
                <span class="data row__dim">{file.sizeGq} GB</span>
                {file.encrypted ? (
                  <span class="row__decrypt">
                    {decrypting ? (
                      <TaskProgress taskId={decrypting.id} label="Decrypting" />
                    ) : (
                      <button type="button" class="btn btn--go" data-tip="Run your decrypter on this file so it can be read" onClick={() => decrypt(file.name)}>
                        Decrypt
                      </button>
                    )}
                  </span>
                ) : isProgram ? (
                  <span class="row__decrypt">
                    {decompiling ? (
                      <TaskProgress taskId={decompiling.id} label="Decompiling" />
                    ) : (
                      <button
                        type="button"
                        class="btn btn--go"
                        data-tip="Take this program apart for a module you can fit at the Workbench (the other tab of this window)"
                        onClick={() => decompile(file.name)}
                      >
                        Decompile
                      </button>
                    )}
                  </span>
                ) : null}
                <button type="button" class="btn" onClick={() => viewer.open({ serverId: file.from, name: file.name, sizeGq: file.sizeGq })}>
                  Open
                </button>
                <ConfirmButton
                  class="btn btn--danger"
                  confirmLabel="Delete?"
                  tip="Delete this file to free storage."
                  onConfirm={() => session.dispatch({ type: 'deleteStoredFile', name: file.name })}
                >
                  Delete
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
    </>
  );
}
