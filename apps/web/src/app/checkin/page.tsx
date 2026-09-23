import type { Metadata } from 'next';
import { CheckInApp } from '@/components/checkin/checkin-app';

/**
 * `/checkin` — the screen that lives on the reception tablet (BR-9.4).
 *
 * Deliberately outside the locale routes and outside the CRM: it is not a page anybody
 * browses to, it is a device that sits on a desk. It pairs once with a six-digit code
 * and is a member's own screen after that.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Max Fitness — Attendance',
  robots: { index: false, follow: false },
};

export default function CheckInPage() {
  return (
    <main className="min-h-dvh bg-brand-paper p-6">
      <CheckInApp />
    </main>
  );
}
