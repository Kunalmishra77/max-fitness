import type { SVGProps } from 'react';

/**
 * Max Register's icons (ADR-062): one consistent line set in place of emoji, which
 * render differently on every phone. 24px grid, 1.8 stroke, `currentColor`, decorative.
 */

export type CrmIconName =
  | 'home'
  | 'members'
  | 'fees'
  | 'attendance'
  | 'calls'
  | 'leads'
  | 'verify'
  | 'reports'
  | 'import'
  | 'staff'
  | 'settings'
  | 'pin'
  | 'more'
  | 'bell'
  | 'logout'
  | 'plus'
  | 'language'
  | 'back'
  | 'chevron'
  | 'cake'
  | 'whatsapp'
  | 'search';

const PATHS: Record<CrmIconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z',
  members: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 3.65a3.5 3.5 0 0 1 0 6.7',
  fees: 'M6 4h12M6 8h12M13.5 20 7 13h2.5a4.5 4.5 0 0 0 0-9M6 13h3.5',
  attendance: 'M4 12.5 9 17.5 20 6.5',
  calls: 'M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z',
  leads: 'M4 5h16v11H8l-4 4V5ZM8 9.5h8M8 12.5h5',
  verify: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3ZM8.5 12l2.5 2.5 4.5-5',
  reports: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  import: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  staff: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2.5 20v-1a5 5 0 0 1 5-5h3M17.5 14v6M14.5 17h6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.6 7.6 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4-2-1.6Z',
  pin: 'M15.5 8.5a4 4 0 1 1-7.1 2.5L3 16.5V20h3.5v-2H9v-2.5h2.5l1.5-1.5a4 4 0 0 0 2.5-7.5ZM16 7.5h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12H15',
  plus: 'M12 5v14M5 12h14',
  language: 'M4 5h9M8.5 3v2M11 5c-1 4.5-3.5 7.5-7 9M6 8.5c1.2 2.2 3 4 5.5 5.5M13 21l4-10 4 10M14.5 17.5h5',
  back: 'M15 5 8 12l7 7',
  chevron: 'm9 5 7 7-7 7',
  cake: 'M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 5 0M12 12V8M12 5.5c.8 0 1.2-.7 1.2-1.3 0-.9-1.2-2.2-1.2-2.2s-1.2 1.3-1.2 2.2c0 .6.4 1.3 1.2 1.3Z',
  whatsapp: 'M4 20l1.2-3.6A8 8 0 1 1 8 19l-4 1ZM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8A5 5 0 0 1 11 10.8l.8-1-1-2-1.8.7Z',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM21 21l-5.2-5.2',
};

export function CrmIcon({ name, className, ...rest }: { name: CrmIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-6'}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
