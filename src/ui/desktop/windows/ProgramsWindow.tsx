import { findProgram, findServer, usedStorageGq } from '../../../core';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { TaskProgress, describeTarget } from '../TaskProgress';
import { Window } from '../Window';

/** What the gateway is running, which programs are installed, and the files it holds. */
export function ProgramsWindow() {
  const game = useWorld((state) => state);
  const used = usedStorageGq(game);
  const serverName = (id: string) => findServer(content, id)?.name ?? id;

  return (
    <Window id="programs" note={`${game.tasks.length} of ${content.rules.maxRunningPrograms} running`}>
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
                  <strong>{findProgram(content, task.programId)?.name ?? task.programId}</strong>
                  <span class="row__dim"> · {connection ? serverName(connection.serverId) : ''}</span>
                </span>
                <TaskProgress taskId={task.id} label={describeTarget(task.target)} />
                <button type="button" class="btn" onClick={() => session.dispatch({ type: 'cancelProgram', taskId: task.id })}>
                  Stop
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3 class="map__heading section-gap">Installed</h3>
      <ul class="rows">
        {game.player.programs.map((id) => {
          const program = findProgram(content, id);
          return (
            program && (
              <li key={id} class="row row--program">
                <span class="row__main">
                  <strong>{program.name}</strong> <span class="data row__dim">v{program.version}</span>
                </span>
                <span class="row__dim">{program.blurb}</span>
              </li>
            )
          );
        })}
      </ul>

      <h3 class="map__heading section-gap">
        Stored files{' '}
        <span class="data heading__note">
          {used} / {content.rules.storageGq} Gq
        </span>
      </h3>
      {game.player.files.length === 0 ? (
        <p class="empty">No files yet.</p>
      ) : (
        <ul class="rows data">
          {game.player.files.map((file) => (
            <li key={file.name} class="row row--stored">
              <span class="row__main">{file.name}</span>
              <span class="row__dim">{file.sizeGq} Gq</span>
              <span class="row__dim">{serverName(file.from)}</span>
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}
