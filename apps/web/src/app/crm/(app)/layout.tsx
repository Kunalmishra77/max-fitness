import type { ReactNode } from 'react';
import { requireCrmContext } from '@/lib/crm';

/**
 * Everything behind the login (crm-ux-blueprint §2).
 *
 * Resolving the session here means no CRM screen can render without an actor, and the
 * padding leaves room for the fixed bottom tab bar each page renders.
 */

export const dynamic = 'force-dynamic';

export default async function CrmAppLayout({ children }: { children: ReactNode }) {
  await requireCrmContext();
  return <div className="mx-auto min-h-dvh max-w-xl pb-24">{children}</div>;
}
