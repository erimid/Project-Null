import { useState } from 'preact/hooks';
import { findProgram, findServer, hostedModel, installedOfKind, ownedProgram, programFile, maxPrograms, programStorageGq, rackStorageGb, storageGb, usedStorageGq } from '../../../core';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { ConfirmButton } from '../ConfirmButton';
import { TaskProgress, describeTarget, findTask } from '../TaskProgress';
import { viewer } from '../viewerStore';
import { FileName } from '../FileName';
import { Window } from '../Window';

/**
 * The gateway's programs and storage: what is running, how the room is
 * used, and buttons to remove a program or delete a file to free some.
 */
export function ProgramsWindow() {
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
  const isRunning = (programId: string) => game.tasks.some((task) => task.programId === programId);

  return (
    <Window id="programs" note={`${game.tasks.length} of ${maxPrograms(game, content)} running`}>
      <h3 class="map__heading">Running</h3>
      {game.tasks.length === 0 ? (
        <p class="empty">Nothing is running. Programs start from buttons on a server you are connected to.</p>
      ) : (
        <ul class="rows">
          {game.tasks.map((task) => {
            const connection = game.connections.find((item) => item.id === task.connectionId);
            return (
              <li key={task.id} class="row row--task">
                <span class="row__main">
                  <strong>{findProgram(content, task.programId, game)?.name ?? task.programId}</strong>
                  <span class="row__dim"> · {connection ? serverName(connection.serverId) : 'Gateway'}</span>
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
        Storage{' '}
        <span class="data heading__note">
          {used} of {capacity} GB used
        </span>
      </h3>
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
        <span class="storage__dot" /> Free <span class="data">{free} GB</span>
      </p>
      {used > capacity && (
        <p class="board__warning">Your gateway holds more than its drive is meant to. Nothing new fits until you free some room.</p>
      )}

      <h3 class="map__heading section-gap">Installed programs</h3>
      <ul class="rows rows--scroll">
        {game.player.programs.map((id) => {
          const program = findProgram(content, id, game);
          const built = game.player.builds.some((build) => build.id === id);
          // Where there is a choice of program for a job, say which one runs.
          const choice = program ? installedOfKind(game, content, program.kind).length > 1 : false;
          const inUse = program ? ownedProgram(game, content, program.kind)?.id === id : false;
          return (
            program && (
              <li key={id} class="row row--program">
                <span class="row__main">
                  <strong>{program.name}</strong> <span class="data row__dim">v{program.version}</span>
                  <span class="program__blurb">{program.blurb}</span>
                </span>
                <span class="data row__dim">{program.sizeGq} GB</span>
                {choice &&
                  (inUse ? (
                    <span class="row__done">In use</span>
                  ) : (
                    <button
                      type="button"
                      class="btn"
                      data-tip="Use this version instead of the others of the same kind"
                      onClick={() => session.dispatch({ type: 'preferProgram', programId: id })}
                    >
                      Use
                    </button>
                  ))}
                {isRunning(id) ? (
                  <span class="row__done">Running</span>
                ) : (
                  <ConfirmButton
                    class="btn btn--danger"
                    confirmLabel={built ? 'Scrap?' : 'Remove?'}
                    tip={built ? 'Take this build apart and get its modules back.' : 'Uninstall to free storage. The market gives it back if you need it.'}
                    onConfirm={() => session.dispatch({ type: 'uninstallProgram', programId: id })}
                  >
                    {built ? 'Scrap' : 'Remove'}
                  </ConfirmButton>
                )}
              </li>
            )
          );
        })}
      </ul>
      {game.player.programs.length === 0 && <p class="empty">No programs installed. The Backroom market has them.</p>}

      <h3 class="map__heading section-gap">Stored files</h3>
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
              <span class="row__main data">
                <FileName name={file.name} />
                <span class="program__blurb">
                  from {serverName(file.from)}
                  {file.encrypted ? <span class="sealed"> · encrypted, level {file.encrypted}</span> : null}
                  {isProgram ? <span> · a program, can be decompiled</span> : null}
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
                      data-tip="Take this program apart for a module you can fit at the Workbench"
                      onClick={() => decompile(file.name)}
                    >
                      Decompile
                    </button>
                  )}
                </span>
              ) : null}
              <button
                type="button"
                class="btn"
                onClick={() => viewer.open({ serverId: file.from, name: file.name, sizeGq: file.sizeGq })}
              >
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
    </Window>
  );
}
