import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WithIntl } from '@/test/intl';
import { MessageList, type MessageRow } from './message-list';

/**
 * "मैसेज" — what the gym sent, and what happened to it (crm-module-spec §8).
 *
 * The owner's question is "did it reach them, and if not why", so each row says who it
 * went to, what it was for, how far it got, and — when it did not go — the reason in
 * words rather than a provider code.
 */

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'msg_1',
  memberId: 'mem_1',
  memberName: 'Anita Rao',
  direction: 'OUTBOUND',
  purpose: 'REMINDER',
  status: 'DELIVERED',
  ruleCode: 'PRE_7',
  bodyPreview: 'नमस्ते अनीता, आपकी मेंबरशिप 30 सित॰ 2026 को खत्म हो रही है।',
  errorCode: null,
  at: '2026-09-23T04:30:00.000Z',
  ...over,
});

describe('MessageList', () => {
  it('shows who it went to, what it was for and how far it got', () => {
    render(
      <WithIntl>
        <MessageList rows={[row()]} />
      </WithIntl>,
    );

    const item = screen.getByRole('article', { name: 'Anita Rao' });
    expect(within(item).getByText('Renewal reminder')).toBeTruthy();
    expect(within(item).getByText('Delivered')).toBeTruthy();
    expect(within(item).getByText(/नमस्ते अनीता/)).toBeTruthy();
  });

  it('says in words why a message did not go', () => {
    render(
      <WithIntl>
        <MessageList
          rows={[
            row({ id: 'a', status: 'SKIPPED', errorCode: 'NUMBER_CAP' }),
            row({ id: 'b', memberName: 'Rohit Rao', status: 'SKIPPED', errorCode: 'SUPERSEDED_BY_NEWER_MEMBERSHIP' }),
            row({ id: 'c', memberName: 'Kunal Sethi', status: 'FAILED', errorCode: '131026' }),
            row({ id: 'd', memberName: 'Farah Shukla', status: 'FAILED', errorCode: '999999' }),
          ]}
        />
      </WithIntl>,
    );

    expect(screen.getByText('This number already had its messages for the day')).toBeTruthy();
    expect(screen.getByText('They had already renewed')).toBeTruthy();
    expect(screen.getByText('This number cannot receive WhatsApp')).toBeTruthy();
    // A provider code we have no words for is shown as it is, rather than guessed at.
    expect(screen.getByText('999999')).toBeTruthy();
  });

  it('marks a message the demo only simulated', () => {
    render(
      <WithIntl>
        <MessageList rows={[row({ status: 'SIMULATED' })]} />
      </WithIntl>,
    );
    expect(screen.getByText('Demo — not really sent')).toBeTruthy();
  });

  it('says so when there is nothing to show', () => {
    render(
      <WithIntl>
        <MessageList rows={[]} />
      </WithIntl>,
    );
    expect(screen.getByText('No messages yet.')).toBeTruthy();
  });
});
