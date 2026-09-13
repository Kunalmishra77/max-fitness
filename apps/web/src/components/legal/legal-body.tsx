import { Fragment } from 'react';
import { Link } from '@/i18n/navigation';
import { parseInline, type LegalBlock } from '@/lib/legal-markdown';

/** Renders parsed legal Markdown as React elements — no raw HTML path exists. */

const linkClass = 'font-semibold text-brand-wall-blue underline underline-offset-4 hover:no-underline';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        if (token.type === 'strong') {
          return (
            <strong key={i} className="font-semibold">
              {token.text}
            </strong>
          );
        }
        if (token.type === 'link') {
          return token.href.startsWith('/') ? (
            <Link key={i} href={token.href} className={linkClass}>
              {token.text}
            </Link>
          ) : (
            <a key={i} href={token.href} className={linkClass}>
              {token.text}
            </a>
          );
        }
        return <Fragment key={i}>{token.text}</Fragment>;
      })}
    </>
  );
}

export function LegalBody({ blocks, lang }: { blocks: readonly LegalBlock[]; lang?: string | undefined }) {
  return (
    <div lang={lang} className="mt-10 grid gap-5 text-body leading-body">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h2':
            return (
              <h2 key={i} className="mt-6 font-display text-display-m leading-tight font-bold text-brand-plate-navy">
                <Inline text={block.text} />
              </h2>
            );
          case 'h3':
            return (
              <h3 key={i} className="mt-2 text-title font-semibold text-brand-plate-navy">
                <Inline text={block.text} />
              </h3>
            );
          case 'p':
            return (
              <p key={i} className="max-w-[70ch]">
                <Inline text={block.text} />
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="grid max-w-[70ch] list-disc gap-2 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}
