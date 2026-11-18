import { gameInfo } from '../../content';

/**
 * The one window on the empty desktop. It shows the build number, which is
 * the quick way to check that the live site picked up the latest merge.
 */
export function GatewayWindow() {
  return (
    <section class="window" style={{ left: '30px', top: '28px', width: '420px' }} aria-label="Gateway">
      <div class="window__title">
        <span>Gateway</span>
        <span class="window__title-note">{gameInfo.title}</span>
      </div>
      <div class="window__body">
        <dl class="readout data">
          <dt>status</dt>
          <dd class="is-ok">online</dd>
          <dt>uplink</dt>
          <dd>idle</dd>
          <dt>build</dt>
          <dd>
            {__APP_VERSION__} · {__APP_COMMIT__}
          </dd>
        </dl>
      </div>
    </section>
  );
}
