'use client';

import { useTransition } from 'react';
import { logoutAction } from '@/app/crm/actions';

/** Ends the session on the server and clears the cookie (security-plan.md §3.1). */
export function LogoutButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void logoutAction())}
      className="min-h-11 rounded-button px-3 text-small font-semibold text-brand-rubber-grey"
    >
      {label}
    </button>
  );
}
