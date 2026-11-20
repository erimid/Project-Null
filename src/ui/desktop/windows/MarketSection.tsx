import { useState } from 'preact/hooks';
import {
  compareProgram,
  freeStorageGb,
  marketGrade,
  programPace,
  rareToday,
  rentedModel,
  sellsModule,
  sellsProgram,
  shopOf,
  shopPrice,
  speedShare,
  topVersion,
  type ProgramComparison,
} from '../../../core';
import type { ModuleDef, ProgramDef } from '../../../core/content';
import { formatGameTime, formatMoney, formatSeconds, sizeChange, speedWord } from '../../format';
import { content } from '../../session';
import { deskStore } from '../deskStore';
import { IconTile, Pips, StatBar } from '../Gear';
import { Icon, PROGRAM_GROUPS, groupOf, kindLabel, moduleIcon, programIcon, type IconName } from '../Icon';
import type { View } from './serverView';
import { Price, ShopSign, hoursLeftToday } from './Shop';

type Category = 'all' | 'rare' | (typeof PROGRAM_GROUPS)[number]['id'] | 'modules' | 'models';

/** The counter and filters last looked at, so going to Hardware and back does not lose them. */
let kept: { category: Category; upgrades: boolean; afford: boolean } = { category: 'all', upgrades: false, afford: false };

/** What a rented model can do, in a word or two each. */
const MODEL_SKILLS: Record<string, string> = {
  read: 'Reads files',
  scrub: 'Picks log lines',
  review: 'Checks messages',
  watch: 'Watches traces',
};

/** What a trait does, in the fewest words. */
const TRAIT_WORDS: Record<string, string> = {
  quiet: 'Monitors do not notice it',
  tidy: 'Leaves no line in the log',
  parallel: 'Does not use up a program slot',
};

/** What fitting one grade of a module does to a program, in words. */
function gradeEffect(grade: { speed: number; size: number }): string {
  const parts: string[] = [];
  if (Math.abs(grade.speed - 1) > 0.001) parts.push(speedWord(grade.speed));
  if (Math.abs(grade.size - 1) > 0.001) parts.push(`${Math.round(Math.abs(grade.size - 1) * 100)}% ${grade.size > 1 ? 'bigger' : 'smaller'}`);
  return parts.join(', ') || 'no cost in speed or size';
}

const LAYER_KINDS: ReadonlySet<string> = new Set(['breakPassword', 'bypassProxy', 'bypassFirewall', 'bypassMonitor', 'decrypt']);

/** The line under a program's bars: how it measures up against the one the player runs. */
function compareText(program: ProgramDef, compare: ProgramComparison): { text: string; tone: '' | 'better' | 'worse' } {
  const { current } = compare;
  if (compare.owned) return { text: current?.id === program.id ? 'Installed, and the one you run.' : 'Installed.', tone: '' };
  if (!current) return { text: 'Nothing you own does this.', tone: 'better' };
  const parts: string[] = [];
  if (compare.speed !== undefined) parts.push(speedWord(compare.speed));
  // A higher version of a layer breaker takes on stronger layers; for the rest a version is only speed.
  if (compare.versions !== 0 && LAYER_KINDS.has(program.kind)) parts.push(compare.versions > 0 ? 'takes on stronger security' : 'weaker');
  else if (compare.versions !== 0 && compare.speed === undefined) parts.push(compare.versions > 0 ? 'a newer version' : 'an older version');
  if (compare.sizeGq !== 0) parts.push(sizeChange(compare.sizeGq));
  const yours = current.name === program.name ? `v${current.version}` : `${current.name} v${current.version}`;
  const worse = compare.versions < 0 || (compare.versions === 0 && compare.speed !== undefined && compare.speed < 0.99);
  return { text: `You run ${yours}. This is ${parts.join(', ') || 'the same'}.`, tone: compare.upgrade ? 'better' : worse ? 'worse' : '' };
}

/** The biggest program in the catalogue: the full length of a size bar. */
const biggestProgram = (): number => Math.max(1, ...content.programs.map((program) => program.sizeGq));

function ProgramCard({ program, rare, view }: { program: ProgramDef; rare: boolean; view: View }) {
  const { game, server, connection, act } = view;
  const shop = shopOf(server);
  const compare = compareProgram(game, content, program);
  const price = shopPrice(shop, program.price);
  const free = freeStorageGb(game, content);
  const noRoom = program.sizeGq > free;
  const poor = game.player.balance < price;
  const line = compareText(program, compare);
  const speed = speedShare(content, program);
  const mine = compare.current && !compare.owned ? compare.current : undefined;
  const mineSpeed = mine ? speedShare(content, mine) : undefined;
  const biggest = biggestProgram();
  const speedTone = compare.owned || compare.speed === undefined ? undefined : compare.speed > 1.01 ? 'better' : compare.speed < 0.99 ? 'worse' : undefined;
  const sizeTone = compare.owned || !mine || compare.sizeGq === 0 ? undefined : compare.sizeGq < 0 ? 'better' : 'worse';
  return (
    <li class={`card card--program${compare.owned ? ' is-owned' : ''}${rare ? ' is-rare' : ''}${compare.upgrade && !compare.owned ? ' is-upgrade' : ''}`}>
      <div class="card__head">
        <IconTile icon={programIcon(program.kind)} tone={rare ? 'rare' : undefined} />
        <div class="card__title">
          <strong>{program.name}</strong>
          <span class="card__sub">
            {kindLabel(program.kind)}
            <span class="card__version">
              <span class="data">v{program.version}</span>
              <Pips on={program.version} of={topVersion(content, program.kind)} label={`version ${program.version} of ${topVersion(content, program.kind)}`} />
            </span>
          </span>
        </div>
        {rare && <span class="row__tag row__tag--rare card__tag">today only</span>}
      </div>
      <p class="card__blurb">{program.blurb}</p>
      <div class="card__stats">
        {speed !== undefined && (
          <StatBar
            label="Speed"
            share={speed}
            mine={mineSpeed}
            value={formatSeconds(programPace(program))}
            tone={speedTone}
            tip="Time on standard work: a level 1 layer, or a 10 GB file. The bar is measured against the fastest of its kind. The tick is the one you run."
          />
        )}
        <StatBar
          label="Size"
          share={program.sizeGq / biggest}
          mine={mine ? mine.sizeGq / biggest : undefined}
          value={`${program.sizeGq} GB`}
          tone={sizeTone}
          tip="Room it takes on your gateway. The tick is the one you run."
        />
      </div>
      <p class={`card__compare${line.tone ? ` is-${line.tone}` : ''}`}>
        {line.tone === 'better' && <Icon name="up" size={15} />}
        {compare.owned && <Icon name="check" size={15} />}
        <span>{line.text}</span>
      </p>
      <div class="card__foot">
        <Price base={program.price} price={price} />
        {compare.owned ? (
          <span class="card__owned">Owned</span>
        ) : (
          <button
            type="button"
            class="btn btn--go card__buy"
            disabled={poor || noRoom}
            title={noRoom ? 'Not enough room on your gateway' : poor ? 'You cannot afford this yet' : undefined}
            onClick={() => act({ type: 'buyProgram', connectionId: connection.id, programId: program.id })}
          >
            {price > 0 ? 'Buy' : 'Install'}
          </button>
        )}
      </div>
    </li>
  );
}

/** A module on the shelf: what it does, what it fits, and a button for each grade in stock. `only` = just that grade (a rare line). */
function ModuleCard({ module, only, view }: { module: ModuleDef; only?: number; view: View }) {
  const { game, server, connection, act } = view;
  const shop = shopOf(server);
  const best = marketGrade(game, content);
  const nextAt = content.rules.moduleGradeRatings[best];
  const grades = module.grades
    .map((grade, index) => ({ grade, number: index + 1 }))
    .filter(({ number }) => (only === undefined ? number <= best && sellsModule(game, server, module, number) : number === only));
  const locked = only === undefined && nextAt !== undefined && best < module.grades.length && sellsModuleLater(view, module, best + 1);
  const onHand = module.grades.reduce((sum, _, index) => sum + (game.player.parts[`${module.id}:${index + 1}`] ?? 0), 0);
  return (
    <li class={`card card--module tone--${module.id}${only !== undefined ? ' is-rare' : ''}`}>
      <div class="card__head">
        <IconTile icon={moduleIcon(module.id)} tone={module.id} />
        <div class="card__title">
          <strong>{module.name}</strong>
          <span class="card__sub">{module.trait ? TRAIT_WORDS[module.trait] : 'Module for your Workbench'}</span>
        </div>
        {only !== undefined ? <span class="row__tag row__tag--rare card__tag">today only</span> : onHand > 0 && <span class="card__have data">×{onHand} on hand</span>}
      </div>
      <p class="card__blurb">{module.blurb}</p>
      <p class="card__fits">
        <span class="card__fits-label">Fits</span>
        {module.fits.map((kind) => (
          <span key={kind} class="card__fit" title={kindLabel(kind)}>
            <Icon name={programIcon(kind)} size={16} />
          </span>
        ))}
      </p>
      <ul class="grades">
        {grades.map(({ grade, number }) => {
          const price = shopPrice(shop, grade.price);
          return (
            <li key={number}>
              <button
                type="button"
                class={`grade grade--${number}`}
                disabled={game.player.balance < price}
                title={game.player.balance < price ? 'You cannot afford this yet' : `Buy one ${module.name}, grade ${number}`}
                onClick={() => act({ type: 'buyModule', connectionId: connection.id, moduleId: module.id, grade: number })}
              >
                <Pips on={number} of={module.grades.length} label={`grade ${number}`} class="pips--grade" />
                <span class="grade__effect">{gradeEffect(grade)}</span>
                <span class="grade__price data">{formatMoney(price)}</span>
              </button>
            </li>
          );
        })}
        {locked && (
          <li class="grade grade--locked">
            <Icon name="lock" size={14} />
            <span class="grade__effect">
              Grade {best + 1} at rating {nextAt}
            </span>
          </li>
        )}
      </ul>
    </li>
  );
}

/** True if the shop would stock this grade once the player's rating allows it. */
function sellsModuleLater({ server }: View, _module: ModuleDef, grade: number): boolean {
  const shop = shopOf(server);
  return shop.modules && grade <= (shop.maxGrade ?? Infinity);
}

function ModelCard({ model, view }: { model: (typeof content.models)[number]; view: View }) {
  const { game, server, connection, act } = view;
  const price = shopPrice(shopOf(server), model.price);
  const mine = rentedModel(game, content)?.id === model.id;
  return (
    <li class={`card card--model${mine ? ' is-owned' : ''}`}>
      <div class="card__head">
        <IconTile icon="model" tone="model" />
        <div class="card__title">
          <strong>{model.name}</strong>
          <span class="card__sub">
            Rented by the day <span class="data">· {content.rules.modelRentHours} h</span>
          </span>
        </div>
      </div>
      <p class="card__blurb">{model.blurb}</p>
      <p class="card__skills">
        {model.skills.map((skill) => (
          <span key={skill} class="card__skill">
            {MODEL_SKILLS[skill] ?? skill}
          </span>
        ))}
      </p>
      {mine && game.player.model && (
        <p class="card__compare is-better">
          <Icon name="check" size={15} />
          <span>Yours until {formatGameTime(game.player.model.untilMs)}.</span>
        </p>
      )}
      <div class="card__foot">
        <span class="data contract__pay price">{formatMoney(price)}</span>
        <button
          type="button"
          class="btn btn--go card__buy"
          disabled={game.player.balance < price}
          title={game.player.balance < price ? 'You cannot afford this yet' : undefined}
          onClick={() => act({ type: 'rentModel', connectionId: connection.id, modelId: model.id })}
        >
          {mine ? 'Add a day' : 'Rent'}
        </button>
      </div>
    </li>
  );
}

/** The Market: a shop floor. A lit shelf for the day's rare stock, counters by kind, and cards that compare each program with yours. */
export function Market(view: View) {
  const { game, server, connection } = view;
  const [filters, setFilters] = useState(kept);
  const change = (next: Partial<typeof kept>) => {
    kept = { ...filters, ...next };
    setFilters(kept);
  };
  const shop = shopOf(server);
  const rareLines = rareToday(game, server);
  const rareIds = new Set(rareLines.map((line) => `${line.kind}:${line.id}`));

  // Starting programs only show up here if the player has removed one: the market gives those back.
  const forSale = content.programs.filter(
    (program) =>
      (program.price > 0 || (content.startingPrograms.includes(program.id) && !game.player.programs.includes(program.id))) &&
      sellsProgram(game, server, program),
  );
  const rarePrograms = forSale.filter((program) => rareIds.has(`program:${program.id}`));
  const rareModules = rareLines
    .filter((line) => line.kind === 'module')
    .map((line) => ({ module: content.modules.find((module) => module.id === line.id), grade: line.grade ?? 1 }))
    .filter((item): item is { module: ModuleDef; grade: number } => !!item.module);
  const rareHardware = rareLines.filter((line) => line.kind === 'hardware').map((line) => content.hardware.find((part) => part.id === line.id)?.name);
  // Each counter runs kind by kind, weakest version first, so the same tool's versions sit side by side.
  const kindOrder = PROGRAM_GROUPS.flatMap((group) => group.kinds as readonly string[]);
  const staples = forSale
    .filter((program) => !rareIds.has(`program:${program.id}`))
    .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.version - b.version || a.price - b.price);
  const rareCount = rarePrograms.length + rareModules.length;
  const modules = shop.modules ? content.modules : [];
  const models = shop.models ? content.models : [];

  const counters: { id: Category; label: string; icon: IconName; count: number }[] = [
    { id: 'all', label: 'All', icon: 'grid', count: rareCount + staples.length + modules.length + models.length },
    { id: 'rare', label: 'Today', icon: 'star', count: rareCount },
    ...PROGRAM_GROUPS.map((group) => ({ id: group.id as Category, label: group.label, icon: group.icon as IconName, count: staples.filter((program) => groupOf(program.kind) === group.id).length })),
    { id: 'modules', label: 'Modules', icon: 'module', count: modules.length },
    { id: 'models', label: 'Models', icon: 'model', count: models.length },
  ];
  const open = counters.filter((counter) => counter.count > 0);
  const category = open.some((counter) => counter.id === filters.category) ? filters.category : 'all';

  const passes = (program: ProgramDef) =>
    (!filters.upgrades || compareProgram(game, content, program).upgrade) &&
    (!filters.afford || game.player.balance >= shopPrice(shop, program.price));
  const groups = PROGRAM_GROUPS.filter((group) => category === 'all' || category === group.id)
    .map((group) => ({ group, items: staples.filter((program) => groupOf(program.kind) === group.id && passes(program)) }))
    .filter(({ items }) => items.length > 0);
  // The filters are about programs and prices: a module is never an "upgrade", so that filter leaves the module counter alone.
  const cheapest = (module: ModuleDef) => shopPrice(shop, module.grades[0]?.price ?? 0);
  const shownModules = category === 'all' || category === 'modules' ? modules.filter((module) => !filters.afford || game.player.balance >= cheapest(module)) : [];
  const shownModels =
    category === 'all' || category === 'models' ? models.filter((model) => !filters.afford || game.player.balance >= shopPrice(shop, model.price)) : [];
  const hidden =
    (category === 'all' || PROGRAM_GROUPS.some((group) => group.id === category)
      ? staples.filter((program) => category === 'all' || groupOf(program.kind) === category).length - groups.reduce((sum, { items }) => sum + items.length, 0)
      : 0) +
    (category === 'all' || category === 'modules' ? modules.length - shownModules.length : 0) +
    (category === 'all' || category === 'models' ? models.length - shownModels.length : 0);
  const nothing = groups.length === 0 && shownModules.length === 0 && shownModels.length === 0 && category !== 'rare' && !(category === 'all' && rareCount > 0);
  const hoursLeft = hoursLeftToday(game);

  return (
    <div class="shopfloor">
      <ShopSign game={game} server={server} rare={false} />

      <div class="shopbar">
        <div class="shoptabs" role="tablist" aria-label="Counters">
          {open.map((counter) => (
            <button
              key={counter.id}
              type="button"
              role="tab"
              class={`shoptab${counter.id === category ? ' is-current' : ''}${counter.id === 'rare' ? ' shoptab--rare' : ''}`}
              aria-selected={counter.id === category}
              onClick={() => change({ category: counter.id })}
            >
              <Icon name={counter.icon} size={18} />
              <span>{counter.label}</span>
              <span class="shoptab__count data">{counter.count}</span>
            </button>
          ))}
        </div>
        <div class="shopfilters">
          <button
            type="button"
            class={`toggle${filters.upgrades ? ' is-on' : ''}`}
            aria-pressed={filters.upgrades}
            data-tip="Show only programs that would be a step up from what you run"
            onClick={() => change({ upgrades: !filters.upgrades })}
          >
            <Icon name="up" size={15} /> Upgrades only
          </button>
          <button
            type="button"
            class={`toggle${filters.afford ? ' is-on' : ''}`}
            aria-pressed={filters.afford}
            data-tip="Hide what you cannot pay for right now"
            onClick={() => change({ afford: !filters.afford })}
          >
            <Icon name="coin" size={15} /> Can afford
          </button>
          {hidden > 0 && <span class="shopfilters__note">{hidden} hidden</span>}
        </div>
      </div>

      {(category === 'all' || category === 'rare') && (
      <section class={`rareshelf${rareCount === 0 ? ' is-bare' : ''}`} aria-label="Today only">
        <h3 class="rareshelf__head">
          <Icon name="star" size={16} />
          <span>Today only</span>
          <span class="rareshelf__clock">
            <Icon name="clock" size={14} /> {rareCount + rareHardware.length > 0 ? `gone in ${hoursLeft} h` : `changes in ${hoursLeft} h`}
          </span>
        </h3>
        {rareCount > 0 ? (
          <ul class="cards">
            {rarePrograms.map((program) => (
              <ProgramCard key={program.id} program={program} rare view={view} />
            ))}
            {rareModules.map(({ module, grade }) => (
              <ModuleCard key={`${module.id}:${grade}`} module={module} only={grade} view={view} />
            ))}
          </ul>
        ) : (
          rareHardware.length === 0 && <p class="rareshelf__none">Nothing rare on the shelf today.</p>
        )}
        {rareHardware.length > 0 && (
          <p class="rareshelf__more">
            <Icon name="chip" size={16} />
            <span>{rareHardware.filter(Boolean).join(', ')} on the hardware counter.</span>
            <button type="button" class="btn" onClick={() => deskStore.showSection(connection.id, 'hardware')}>
              Go to Hardware
            </button>
          </p>
        )}
      </section>
      )}

      {groups.map(({ group, items }) => (
        <section key={group.id} class="shopgroup">
          <h3 class="map__heading">
            <Icon name={group.icon} size={16} /> {group.label}
          </h3>
          <ul class="cards">
            {items.map((program) => (
              <ProgramCard key={program.id} program={program} rare={false} view={view} />
            ))}
          </ul>
        </section>
      ))}
      {shownModules.length > 0 && (
        <section class="shopgroup">
          <h3 class="map__heading">
            <Icon name="module" size={16} /> Modules <span class="heading__note">for your Workbench</span>
          </h3>
          <ul class="cards">
            {shownModules.map((module) => (
              <ModuleCard key={module.id} module={module} view={view} />
            ))}
          </ul>
        </section>
      )}
      {shownModels.length > 0 && (
        <section class="shopgroup">
          <h3 class="map__heading">
            <Icon name="model" size={16} /> Models for rent <span class="heading__note">by the day, from Lowlight Compute</span>
          </h3>
          <ul class="cards">
            {shownModels.map((model) => (
              <ModelCard key={model.id} model={model} view={view} />
            ))}
          </ul>
        </section>
      )}
      {nothing && (
        <p class="empty">
          Nothing here matches. <button type="button" class="place" onClick={() => change({ upgrades: false, afford: false })}>Clear the filters</button>
        </p>
      )}
    </div>
  );
}
