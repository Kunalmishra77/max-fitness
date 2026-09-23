import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WithIntl } from '@/test/intl';
import { SimulatorTimeline, type SimulatorDay } from './simulator-timeline';

/**
 * The 30-day forecast (whatsapp-automation-engine §10).
 *
 * What the owner wants from it is "will this be too many messages, and what will they
 * actually say" — so a day is a row with its count, and a message opens into the text
 * the member would read, not into a template name.
 */

const day = (over: Partial<SimulatorDay> = {}): SimulatorDay => ({
  date: '2026-09-23',
  label: '23 Sep 2026',
  weekday: 'Wed',
  skipped: 0,
  messages: [
    {
      id: 'rem:mem_1:ms_1:PRE_7:2026-09-23:10:00',
      slot: '10:00',
      memberName: 'Anita',
      ruleCode: 'PRE_7',
      preview: 'नमस्ते Anita, आपकी Max Fitness Gym मेंबरशिप 30 सित॰ 2026 को खत्म हो रही है।',
    },
  ],
  ...over,
});

describe('SimulatorTimeline', () => {
  it('shows each day with what it would send', () => {
    render(
      <WithIntl>
        <SimulatorTimeline days={[day()]} totalMessages={1} totalSkipped={0} />
      </WithIntl>,
    );

    const row = screen.getAllByRole('listitem')[0]!;
    expect(within(row).getByText('23 Sep 2026')).toBeTruthy();
    expect(within(row).getByText('10:00')).toBeTruthy();
    expect(within(row).getByText('Anita')).toBeTruthy();
  });

  it('says out loud that it is a forecast, not a promise', () => {
    render(
      <WithIntl>
        <SimulatorTimeline days={[day()]} totalMessages={1} totalSkipped={0} />
      </WithIntl>,
    );

    expect(screen.getByText(/if nothing changes/i)).toBeTruthy();
  });

  it('adds up the month, and the messages a cap would hold back', () => {
    render(
      <WithIntl>
        <SimulatorTimeline days={[day({ skipped: 2 })]} totalMessages={17} totalSkipped={2} />
      </WithIntl>,
    );

    expect(screen.getByText(/17 messages in 30 days/)).toBeTruthy();
    // Once at the top for the month, once on the day it happens.
    expect(screen.getAllByText(/2 held back/i)).toHaveLength(2);
  });

  it('opens a message into the words the member would read', async () => {
    render(
      <WithIntl>
        <SimulatorTimeline days={[day()]} totalMessages={1} totalSkipped={0} />
      </WithIntl>,
    );

    expect(screen.queryByText(/नमस्ते Anita/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Anita/ }));

    expect(screen.getByText(/नमस्ते Anita/)).toBeTruthy();
  });

  it('marks a quiet day rather than leaving a gap', () => {
    render(
      <WithIntl>
        <SimulatorTimeline days={[day({ messages: [] })]} totalMessages={0} totalSkipped={0} />
      </WithIntl>,
    );

    expect(screen.getByText('Nothing to send')).toBeTruthy();
  });
});
