import { useState } from 'preact/hooks';
import { absentAllies, heistAttacker, heistLines, heistStatus, loadedPrograms, maxConnections, planHeist, securityOf } from '../../../core';
import { findServer, type ContractDef } from '../../../core/content';
import { useWorld } from '../../hooks';
import { content, session } from '../../session';
import { Icon } from '../Icon';
import { Place } from './Place';

/** The order the player has picked for each heist's lines, by contract id. Kept while the game runs. */
const orders = new Map<string, string[]>();

const LAYER_WORDS: Record<string, string> = { firewall: 'firewall', monitor: 'monitor', proxy: 'proxy' };

/**
 * The planning screen for a heist: every server involved and what it
 * controls. On the board it shows what the plan needs. Once taken, it
 * shows which desks are held, lets the player put the lines in the order
 * they want, and opens them.
 */
export function HeistPlan({ contract, live }: { contract: ContractDef; live: boolean }) {
  const game = useWorld((state) => state);
  const [, redraw] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const heist = contract.heist;
  if (!heist) return null;
  const vault = findServer(content, contract.targetId);
  const plan = live && game.contracts.heist ? game.contracts.heist : planHeist(game, contract)!;
  const status = live ? heistStatus(game) : plan.holds.map((hold) => ({ ...hold, held: !!hold.ally }));
  // Once taken, the plan that was made counts, not what a new one would be.
  const need = live ? plan.holds.filter((hold) => !hold.ally).length + 1 : heistLines(game, contract);
  const have = maxConnections(game, content);
  const lines = [...status.filter((hold) => !hold.ally).map((hold) => hold.targetId), contract.targetId];
  const order = (orders.get(contract.id) ?? []).filter((id) => lines.includes(id));
  const ordered = [...order, ...lines.filter((id) => !order.includes(id))];
  const move = (id: string, by: number) => {
    const at = ordered.indexOf(id);
    const next = [...ordered];
    const [item] = next.splice(at, 1);
    next.splice(Math.max(0, Math.min(next.length, at + by)), 0, item!);
    orders.set(contract.id, next);
    redraw((n) => n + 1);
  };
  const connected = (id: string) => game.connections.some((connection) => connection.serverId === id);
  const connect = (id: string): boolean => {
    if (connected(id)) return true;
    const result = session.dispatch({ type: 'connect', serverId: id });
    setNotice(result.ok ? null : result.reason);
    return result.ok;
  };
  const vaultSecurity = vault ? securityOf(game, vault) : undefined;
  const serverName = (id: string) => findServer(content, id)?.name ?? id;
  // Before it is taken: who is coming, who is not, who will knock, and what the player brings.
  const missing = absentAllies(game, contract);
  const knocks = !live && heistAttacker(game, contract) !== undefined;
  const slowBy = plan.slow && plan.slow > 1 ? Math.round((plan.slow - 1) * 100) : 0;
  const kit = loadedPrograms(game, content).map((program) => program.name);
  const allyLine = (hold: (typeof status)[number]) => {
    const where = serverName(hold.targetId);
    const what = `the vault's ${LAYER_WORDS[hold.layer]}`;
    if (hold.allyMs === undefined) return <>{hold.ally} holds {where} for you: {what} is off.</>;
    const seconds = Math.ceil(hold.allyMs / 1000);
    if (!live) return <>{hold.ally} holds {where} for the first <span class="data">{seconds}s</span> you are inside the vault. After that it is yours to hold, or be quick.</>;
    if (seconds > 0) return <>{hold.ally} holds {where} for you: <span class="data">{seconds}s</span> left.</>;
    return <>{hold.ally} has let go of {where}. Hold it yourself, or {what} is back.</>;
  };

  const row = (id: string, index: number) => {
    const server = findServer(content, id);
    const hold = status.find((item) => item.targetId === id);
    const written = heist.holds.find((item) => item.targetId === id);
    const isVault = id === contract.targetId;
    return (
      <li key={id} class={`heist__line${hold?.held ? ' is-held' : ''}${isVault ? ' is-vault' : ''}`}>
        <span class="heist__step data" aria-hidden="true">{index + 1}</span>
        <span class="heist__what">
          <strong>{server ? <Place id={server.id}>{server.name}</Place> : id}</strong>
          {isVault ? (
            <span class="heist__note">The vault. {contract.objective.kind === 'steal' ? <>Lift <span class="data">{contract.objective.file}</span>.</> : 'Do the job here.'}</span>
          ) : (
            <>
              {written?.note && <span class="heist__note">{written.note.charAt(0).toUpperCase() + written.note.slice(1)}</span>}
              <span class="heist__note">Hold it as administrator and the vault's {LAYER_WORDS[hold!.layer]} goes off.</span>
            </>
          )}
        </span>
        {live && (
          <span class="heist__state">
            {isVault ? (
              <span class="row__tag">{connected(id) ? 'line open' : 'not connected'}</span>
            ) : (
              <span class={`row__tag${hold?.held ? ' row__tag--good' : ''}`}>{hold?.held ? 'held' : connected(id) ? 'not admin yet' : 'not held'}</span>
            )}
            <button type="button" class="btn btn--small" aria-label="Earlier" disabled={index === 0} onClick={() => move(id, -1)}>
              ↑
            </button>
            <button type="button" class="btn btn--small" aria-label="Later" disabled={index === ordered.length - 1} onClick={() => move(id, 1)}>
              ↓
            </button>
            <button type="button" class="btn btn--small btn--go" disabled={connected(id)} data-tip="Open a line to this server along your current route" onClick={() => connect(id)}>
              Connect
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div class="heist" role="group" aria-label="Heist plan">
      <p class="heist__head">
        <Icon name="route" size={16} />
        <span>
          Heist · <span class="data">{need}</span> {need === 1 ? 'line' : 'lines at once'}
          {need > have ? <span class="heist__short"> · your gateway holds {have}</span> : null}
        </span>
      </p>
      <ol class="heist__lines">{ordered.map(row)}</ol>
      {status
        .filter((hold) => hold.ally)
        .map((hold) => (
          <p key={hold.targetId} class={`heist__ally${hold.allyMs !== undefined && hold.allyMs <= 0 ? ' is-gone' : ''}`}>
            <Icon name="person" size={14} />
            <span>{allyLine(hold)}</span>
          </p>
        ))}
      {missing.map((absent) => (
        <p key={absent.targetId} class="heist__ally is-absent">
          <Icon name="person" size={14} />
          <span>{absent.name} could have held {serverName(absent.targetId)}. Not this time.</span>
        </p>
      ))}
      {!live && (
        <ul class="heist__brings">
          {knocks && <li class="is-warn">Someone will come for your gateway while you are out. You will not know who until they knock.</li>}
          {slowBy > 0 && <li>Friends are slowing the traces on this job: they run <span class="data">{slowBy}%</span> slower.</li>}
          <li>
            You bring <span class="data">{have}</span> {have === 1 ? 'line' : 'lines'} and {kit.length === 0 ? 'no programs loaded' : <>{kit.length === 1 ? 'one program' : `${kit.length} programs`} loaded: <span class="data">{kit.join(', ')}</span></>}.
          </li>
        </ul>
      )}
      {live && vaultSecurity && (
        <p class="heist__vault data">
          Vault now: firewall {vaultSecurity.firewall} · monitor {vaultSecurity.monitor} · proxy {vaultSecurity.proxy}
        </p>
      )}
      {live && (
        <div class="contract__actions">
          <button
            type="button"
            class="btn btn--go"
            disabled={ordered.every(connected)}
            data-tip="Open every line in the order above, each along your current route"
            onClick={() => {
              for (const id of ordered) if (!connect(id)) break;
            }}
          >
            Open the lines in this order
          </button>
        </div>
      )}
      {!live && <p class="heist__warn">Caught on any line, or giving up, burns the plan.</p>}
      {notice && (
        <p class="map__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
