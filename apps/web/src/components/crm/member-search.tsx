'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Search that keeps up with typing (crm-ux-blueprint §4) without a request per keystroke:
 * it waits 300 ms, then replaces the URL, so the list is always shareable and the back
 * button still works.
 *
 * `basePath` is which screen it searches on. The attendance desk searches for someone to
 * mark in and must stay where it is; without this it sent staff to the members list and
 * lost the mark button.
 */
export function MemberSearch({ placeholder, initial, basePath = '/crm/members' }: { placeholder: string; initial: string; basePath?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => {
      router.replace(value.trim() === '' ? basePath : `${basePath}?q=${encodeURIComponent(value.trim())}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [value, initial, basePath, router]);

  return (
    <input
      type="search"
      inputMode="search"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="min-h-14 w-full rounded-input border-2 border-brand-rubber-grey/30 bg-semantic-surface-crm-alt px-4 text-crm-body"
    />
  );
}
