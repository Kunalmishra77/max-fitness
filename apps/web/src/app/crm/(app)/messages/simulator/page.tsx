import { getLocale, getTranslations } from 'next-intl/server';
import { can, projectReminders, projectedTotal } from '@mfp/core';
import { renderTemplate } from '@mfp/integrations/whatsapp';
import { PrismaReminderProjection, PrismaReminderRules } from '@mfp/db';
import { formatISTDate, todayIST } from '@mfp/shared';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { SimulatorTimeline, type SimulatorDay } from '@/components/crm/simulator-timeline';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * The Message Simulator's timeline (whatsapp-automation-engine §10).
 *
 * The owner's real question before switching WhatsApp on is "how many messages is
 * this going to be, and what will they say". So this runs the same `planSlot` the
 * worker runs, against the next thirty dates, and renders each message from the same
 * template the send uses — nothing here is written by hand, so the preview cannot
 * quietly drift from what a member would actually receive.
 *
 * Read-only: it plans and renders, and writes nothing at all.
 */

export const dynamic = 'force-dynamic';

const DAYS = 30;

export default async function MessageSimulatorPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const { clock, prisma } = getContainer();
  const today = todayIST(clock);

  if (!can(actor, 'member.view', clock.now())) {
    return (
      <>
        <CrmHeader title={t('simulator.title')} back="/crm/messages" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('verify.errors.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const ruleReader = new PrismaReminderRules(prisma);
  const [rules, slots, members] = await Promise.all([
    ruleReader.all(gym.id),
    ruleReader.slots(gym.id),
    new PrismaReminderProjection(prisma).members(gym.id, today),
  ]);

  const projected = projectReminders(
    { from: today, days: DAYS, slots, rules, members, maxMessagesPerNumberPerDay: gym.settings.reminders.maxMessagesPerNumberPerDay },
    // The forecast never sends, so the links in it are placeholders rather than
    // real signed tokens: minting thirty days of tokens to throw them away would
    // put working renew links into a screen nobody acts on.
    { tokens: { renewUrl: () => '#', unsubscribePayload: () => '#' } },
  );

  const weekday = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : 'hi-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
  const days: SimulatorDay[] = projected.map((day) => ({
    date: day.date,
    label: formatISTDate(day.date, locale),
    weekday: weekday.format(new Date(`${day.date}T06:00:00+05:30`)),
    skipped: day.skipped,
    messages: day.messages.map((message) => ({
      id: message.intent.idempotencyKey,
      slot: message.slot,
      memberName: message.intent.variables['firstName'] ?? '',
      ruleCode: message.intent.ruleCode,
      preview: renderTemplate(message.intent.templateName, message.intent.language, message.intent.variables),
    })),
  }));

  const total = projectedTotal(projected);

  return (
    <>
      <CrmHeader title={t('simulator.title')} subtitle={t('simulator.helper')} back="/crm/messages" />
      <div className="grid gap-3 p-4 lg:p-0">
        <SimulatorTimeline days={days} totalMessages={total.messages} totalSkipped={total.skipped} />
      </div>
      <BottomNav active="more" />
    </>
  );
}
