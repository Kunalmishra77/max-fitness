import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/** The Phase 1 foundation check moved here from `/`. A development tool: gone in production. */

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function FoundationLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
