import { getTranslations } from 'next-intl/server';
import { busyHours, can, kioskShare, largestRemainderShares, membershipFlow, monthBounds, moneyByMethod } from '@mfp/core';
import { addDays } from '@mfp/shared';
import { BottomNav, CrmHeader, rupees } from '@/components/crm/crm-chrome';
import { BusyHoursChart, Meter, ShareBars, SplitBar } from '@/components/crm/report-charts';
import { getContainer } from '@/lib/container';
import { reportsReader, requireCrmContext } from '@/lib/crm';

/**
 * Reports — "हिसाब" (crm-module-spec §6; crm-ux-blueprint §13).
 *
 * Cards with one number each and, where it helps, one small figure. No tables for the
 * owner — except the table twin every chart keeps behind a button. Owner-only, because
 * most of it is money.
 *
 * "Reminder impact" is named but not measured: it needs the WhatsApp engine (Phase 6),
 * and a card that shows zero would say reminders do not work.
 */

export const dynamic = 'force-dynamic';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
/** Four weeks: every weekday four times, every weekend day four times. */
const ATTENDANCE_DAYS = 28;
const PLAN_MIX_DAYS = 90;

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel bg-white p-4 shadow-sm">
      <h2 className="text-crm-body font-bold text-brand-plate-navy">{title}</h2>
      {subtitle === undefined ? null : <p className="text-small text-brand-rubber-grey">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function CrmReportsPage() {
  const { actor, gym, today } = await requireCrmContext();
  const t = await getTranslations('crm');

  if (!can(actor, 'money.view', getContainer().clock.now())) {
    return (
      <>
        <CrmHeader title={t('reports.title')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-plate-navy">
          {t('reports.ownerOnly')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  const month = monthBounds(today);
  const attendanceFrom = addDays(today, -(ATTENDANCE_DAYS - 1));
  const inputs = await reportsReader().inputs(gym.id, month, {
    attendanceFrom,
    attendanceTo: today,
    planMixFrom: addDays(today, -(PLAN_MIX_DAYS - 1)),
  });

  const money = moneyByMethod({ thisMonth: inputs.paidThisMonth, lastMonth: inputs.paidLastMonth });
  const flow = membershipFlow(inputs.memberships, {
    monthStart: month.start,
    monthEnd: month.end,
    today,
    graceDays: gym.settings.membership.renewalGraceDays,
  });
  const hours = busyHours({ capturedAt: inputs.attendance.map((row) => row.capturedAt), from: attendanceFrom, to: today });
  const kiosk = kioskShare(inputs.attendance.map((row) => row.method));
  const planShares = largestRemainderShares(inputs.planMix.map((row) => row.count));
  const genders = GENDERS.map((gender) => ({ gender, count: inputs.activeByGender.find((row) => row.gender === gender)?.count ?? 0 })).filter(
    (row) => row.count > 0,
  );
  const genderShares = largestRemainderShares(genders.map((row) => row.count));
  const leftTotal = inputs.leftByReason.reduce((sum, row) => sum + row.count, 0);
  const busiest = hours.reduce<(typeof hours)[number] | null>((best, row) => (best === null || row.weekday > best.weekday ? row : best), null);
  const biggestMethod = Math.max(...money.byMethod.map((row) => row.amountPaise), 1);
  const biggestPlan = Math.max(...planShares, 1);

  const deltaLine =
    money.deltaPaise > 0
      ? `▲ ${t('reports.moreThanLast', { amount: rupees(money.deltaPaise) })}`
      : money.deltaPaise < 0
        ? `▼ ${t('reports.lessThanLast', { amount: rupees(-money.deltaPaise) })}`
        : t('reports.sameAsLast');

  return (
    <>
      <CrmHeader title={t('reports.title')} back="/crm/more" />

      <div className="grid gap-3 p-4 pb-24">
        <Card title={t('reports.money')}>
          {/* The hero figure: the one number this screen leads with, in the body sans. */}
          <p className="text-[44px] leading-none font-semibold text-brand-ink">{rupees(money.totalPaise)}</p>
          <p className="mt-2 text-small text-brand-rubber-grey">{deltaLine}</p>
          {money.byMethod.length === 0 ? null : (
            <div className="mt-4">
              <ShareBars
                rows={money.byMethod.map((row) => ({
                  key: row.method,
                  label: t(`reports.methods.${row.method}` as never),
                  length: (row.amountPaise / biggestMethod) * 100,
                  valueText: `${rupees(row.amountPaise)} · ${row.share}%`,
                }))}
              />
            </div>
          )}
          {money.demoPaise > 0 ? <p className="mt-3 text-small text-brand-rubber-grey">{t('reports.demoNote', { amount: rupees(money.demoPaise) })}</p> : null}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card title={t('reports.newMembers')} subtitle={t('reports.thisMonth')}>
            <p className="text-[36px] leading-none font-semibold text-brand-ink">{flow.newMembers}</p>
          </Card>
          <Card title={t('reports.renewals')} subtitle={t('reports.thisMonth')}>
            <p className="text-[36px] leading-none font-semibold text-brand-ink">{flow.renewals}</p>
          </Card>
        </div>

        <Card title={t('reports.renewalRate')}>
          {flow.renewalRate.percent === null ? (
            <p className="text-crm-body text-brand-rubber-grey">{t('reports.renewalRateNone')}</p>
          ) : (
            <>
              <p className="text-[36px] leading-none font-semibold text-brand-ink">{flow.renewalRate.percent}%</p>
              <div className="mt-3">
                <Meter percent={flow.renewalRate.percent} label={t('reports.renewalRate')} />
              </div>
              <p className="mt-2 text-small text-brand-rubber-grey">
                {t('reports.renewalRateDetail', { renewed: flow.renewalRate.renewed, due: flow.renewalRate.due })}
              </p>
            </>
          )}
        </Card>

        <Card title={t('reports.left')} subtitle={t('reports.thisMonth')}>
          {leftTotal === 0 ? (
            <p className="text-crm-body text-brand-rubber-grey">{t('reports.leftNone')}</p>
          ) : (
            <>
              <p className="text-[36px] leading-none font-semibold text-brand-ink">{leftTotal}</p>
              <ul className="mt-3 grid gap-1">
                {inputs.leftByReason.map((row) => (
                  <li key={row.reason} className="flex justify-between text-small text-brand-ink">
                    <span>{t(`reports.reasons.${row.reason}` as never)}</span>
                    <span className="font-semibold">{row.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title={t('reports.busyHours')} subtitle={t('reports.busySubtitle')}>
          {hours.length === 0 ? (
            <p className="text-crm-body text-brand-rubber-grey">{t('reports.busyNone')}</p>
          ) : (
            <>
              {busiest === null ? null : (
                <p className="mb-3 text-small font-semibold text-brand-ink">{t('reports.busiest', { hour: busiest.hour, count: busiest.weekday })}</p>
              )}
              <BusyHoursChart
                rows={hours.map((row) => ({
                  hour: row.hour,
                  hourLabel: t('reports.hour', { hour: row.hour }),
                  weekday: row.weekday,
                  weekend: row.weekend,
                  weekdayText: t('reports.perDay', { count: row.weekday }),
                  weekendText: t('reports.perDay', { count: row.weekend }),
                }))}
                weekdayTitle={t('reports.busyWeekday')}
                weekendTitle={t('reports.busyWeekend')}
                tableHour={t('reports.tableHour')}
                showTable={t('reports.showTable')}
                showChart={t('reports.showChart')}
              />
            </>
          )}
        </Card>

        <Card title={t('reports.planMix')} subtitle={t('reports.planMixSubtitle')}>
          {inputs.planMix.length === 0 ? (
            <p className="text-crm-body text-brand-rubber-grey">{t('reports.planMixNone')}</p>
          ) : (
            <ShareBars
              rows={inputs.planMix.map((row, index) => ({
                key: String(row.durationMonths),
                label: t('reports.months', { count: row.durationMonths }),
                length: ((planShares[index] ?? 0) / biggestPlan) * 100,
                valueText: `${planShares[index] ?? 0}% · ${row.count}`,
              }))}
            />
          )}
        </Card>

        <Card title={t('reports.gender')} subtitle={t('reports.genderSubtitle')}>
          <SplitBar
            rows={genders.map((row, index) => ({
              key: row.gender,
              label: t(`reports.${row.gender}` as never),
              share: genderShares[index] ?? 0,
              valueText: `${genderShares[index] ?? 0}% · ${row.count}`,
            }))}
          />
        </Card>

        <Card title={t('reports.kiosk')} subtitle={t('reports.kioskDetail')}>
          {kiosk === null ? (
            <p className="text-crm-body text-brand-rubber-grey">{t('reports.kioskNone')}</p>
          ) : (
            <>
              <p className="text-[36px] leading-none font-semibold text-brand-ink">{kiosk}%</p>
              <div className="mt-3">
                <Meter percent={kiosk} label={t('reports.kiosk')} />
              </div>
            </>
          )}
        </Card>

        <Card title={t('reports.reminderImpact')}>
          <p className="text-crm-body text-brand-rubber-grey">{t('reports.reminderLater')}</p>
        </Card>
      </div>

      <BottomNav active="more" />
    </>
  );
}
