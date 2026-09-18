'use client';

import { useTransition } from 'react';
import { logoutAction } from '@/app/crm/actions';
import { cn } from '@/lib/cn';
import { CrmIcon } from './crm-icons';

/** Ends the session on the server and clears the cookie (security-plan.md §3.1). */
export function LogoutButton({ label, className, withIcon = false }: { label: string; className?: string; withIcon?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void logoutAction())}
      className={cn('inline-flex min-h-11 items-center gap-2 rounded-button px-3 text-small font-semibold text-brand-stone', className)}
    >
      {withIcon ? <CrmIcon name="logout" className="size-5" /> : null}
      {label}
    </button>
  );
}
