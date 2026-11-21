import { DEFAULT_CHOICE, INNER, STANDING_RANGE, TRUSTED, TRUSTED_PAY, SHOP_DISCOUNT, findServer, knownPatrons, standingName, standingWith } from '../../../core';
import type { Favour } from '../../../content';
import { useWorld } from '../../hooks';
import { content } from '../../session';
import { Icon } from '../Icon';

const FAVOUR_WORDS: Readonly<Record<Favour, string>> = {
  raidWarning: 'Warns you before a rival attacks your gateway, and the attack takes longer.',
  fineCut: 'Pays half of any fine when you are traced.',
  scanTargets: 'Sends the target’s security with every job they post.',
  lieLowCut: 'Halves the time you have to lie low after a trace.',
};

const SECTOR_WORDS: Readonly<Record<string, string>> = { credit: 'lenders', clinic: 'clinics', school: 'schools', energy: 'power companies', law: 'law firms', freight: 'hauliers', retail: 'shops', engineering: 'engineers' };

/** Where a standing sits on the bar, 0 to 100. */
const place = (standing: number) => ((standing - STANDING_RANGE[0]) / (STANDING_RANGE[1] - STANDING_RANGE[0])) * 100;

/**
 * The people who post work under their own names, how they feel about
 * the player, what that is worth, and the record of choices made at the
 * end of jobs.
 */
export function ContactsSection() {
  const known = useWorld((game) => knownPatrons(game, content));
  const standing = useWorld((game) => Object.fromEntries(known.map((patron) => [patron.id, standingWith(game, patron.id)])));
  const choices = useWorld((game) =>
    Object.entries(game.patrons.choices).flatMap(([id, choiceId]) => {
      const contract = content.contracts.find((item) => item.id === id);
      if (!contract) return [];
      const label = choiceId === DEFAULT_CHOICE ? 'Handed over as asked' : (contract.choices?.find((choice) => choice.id === choiceId)?.label ?? choiceId);
      return [{ id, title: contract.title, label, usual: choiceId === DEFAULT_CHOICE }];
    }),
  );

  return (
    <div class="contacts">
      {known.length === 0 ? (
        <p class="empty">
          Nobody knows your name yet. Some jobs on the board are posted by people who sign them: do one well and they will remember you.
        </p>
      ) : (
        <ul class="contacts__list">
          {known.map((patron) => {
            const value = standing[patron.id] ?? 0;
            const shop = patron.shop ? findServer(content, patron.shop) : undefined;
            const perks = [
              { at: 0, text: 'Posts work for you on the board.', on: value >= 0 },
              { at: TRUSTED, text: `Pays ${Math.round((TRUSTED_PAY - 1) * 100)}% more for their own jobs${shop ? `, and ${Math.round(SHOP_DISCOUNT * 100)}% off at ${shop.name}` : ''}.`, on: value >= TRUSTED },
              ...(patron.favour ? [{ at: INNER, text: FAVOUR_WORDS[patron.favour], on: value >= INNER }] : []),
            ];
            return (
              <li key={patron.id} class={`contact is-${standingName(value).toLowerCase().replace(' ', '-')}`}>
                <div class="contact__head">
                  <Icon name="person" size={16} />
                  <strong class="contact__name">{patron.name}</strong>
                  <span class="contact__level">{standingName(value)}</span>
                </div>
                <p class="contact__title">{patron.title}</p>
                <div class="contact__bar" role="meter" aria-valuemin={STANDING_RANGE[0]} aria-valuemax={STANDING_RANGE[1]} aria-valuenow={value} aria-label={`Standing with ${patron.name}`}>
                  <span class="contact__fill" style={{ width: `${place(value)}%` }} />
                  {[0, TRUSTED, INNER].map((line) => (
                    <span key={line} class="contact__tick" style={{ left: `${place(line)}%` }} />
                  ))}
                </div>
                <p class="contact__blurb">{patron.blurb}</p>
                <ul class="contact__perks">
                  {perks.map((perk) => (
                    <li key={perk.at} class={perk.on ? 'is-on' : undefined}>
                      <span class="contact__perk-at">{standingName(perk.at)}</span> {perk.text}
                    </li>
                  ))}
                </ul>
                {patron.protects.length > 0 && <p class="contact__warn">Looks after {patron.protects.map((sector) => SECTOR_WORDS[sector] ?? sector).join(' and ')}. Work against them costs standing.</p>}
              </li>
            );
          })}
        </ul>
      )}
      {choices.length > 0 && (
        <>
          <h3 class="map__heading">Choices you made</h3>
          <ul class="contacts__choices">
            {choices.map((choice) => (
              <li key={choice.id}>
                <span class="contacts__choice-title">{choice.title}</span>
                <span class={`contacts__choice${choice.usual ? '' : ' is-own'}`}>{choice.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
