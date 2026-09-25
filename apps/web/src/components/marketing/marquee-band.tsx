import { getTranslations } from 'next-intl/server';
import { FACILITY_EXTRAS, FACILITY_ZONES } from '@/content/landing-content';

/**
 * A red band of what the floor offers, moving slowly (ADR-061).
 *
 * Only confirmed things are named. The list is written twice so the loop has no seam; the
 * copy is hidden from assistive tech, and the motion pauses on hover and stops with
 * reduced motion (globals.css).
 */
export async function MarqueeBand() {
  const t = await getTranslations('facilities');
  // The zones themselves, so a zone added or removed cannot be left behind here.
  const words = [
    ...FACILITY_ZONES.map((zone) => t(`zones.${zone}.name`)),
    ...FACILITY_EXTRAS.filter((extra) => extra.confirmed).map((extra) => t(`extras.${extra.key}`)),
  ];
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {words.map((word) => (
        <li key={word} className="flex items-center font-display text-display-m font-bold tracking-[0.04em] whitespace-nowrap uppercase">
          <span className="px-8">{word}</span>
          <span aria-hidden className="size-2.5 rotate-45 bg-brand-obsidian" />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="marquee overflow-hidden border-y border-brand-obsidian/20 bg-brand-accent py-4 text-brand-white md:py-5">
      <div className="marquee-track flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
