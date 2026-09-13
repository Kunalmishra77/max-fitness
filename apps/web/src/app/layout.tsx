import type { ReactNode } from 'react';

/**
 * The root layout exists only to satisfy Next's App Router.
 *
 * Everything real — `<html>`, `<body>`, fonts, the locale — lives in
 * `[locale]/layout.tsx`, because the `lang` attribute and the Devanagari
 * line-height adjustment both depend on which locale is being served.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
