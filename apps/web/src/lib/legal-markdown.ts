/**
 * A deliberately small Markdown subset for the legal pages.
 *
 * The drafts in content/legal/*.md are edited by people, not generated, so this
 * parser supports only what they use — `#` title, `##`/`###` headings, paragraphs,
 * `- ` bullet lists, `**bold**`, `[links](https://…)` and an
 * `<!-- updated: YYYY-MM-DD -->` line — and renders to React elements, never to raw
 * HTML. Anything else stays literal text, so a stray `<script>` shows as text.
 */

export type LegalBlock =
  | { readonly type: 'h2' | 'h3' | 'p'; readonly text: string }
  | { readonly type: 'ul'; readonly items: readonly string[] };

export interface LegalDocument {
  readonly title: string;
  readonly updated: string | null;
  readonly blocks: readonly LegalBlock[];
}

export type InlineToken =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'strong'; readonly text: string }
  | { readonly type: 'link'; readonly text: string; readonly href: string };

const UPDATED = /^<!--\s*updated:\s*(\d{4}-\d{2}-\d{2})\s*-->$/;

export function parseLegalMarkdown(source: string): LegalDocument {
  let title = '';
  let updated: string | null = null;
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const endList = () => {
    if (list.length > 0) blocks.push({ type: 'ul', items: list });
    list = [];
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const meta = UPDATED.exec(line);

    if (meta !== null) {
      updated = meta[1] ?? null;
    } else if (line === '') {
      endParagraph();
      endList();
    } else if (line.startsWith('# ')) {
      endParagraph();
      endList();
      title = line.slice(2).trim();
    } else if (line.startsWith('### ')) {
      endParagraph();
      endList();
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
    } else if (line.startsWith('## ')) {
      endParagraph();
      endList();
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (line.startsWith('- ')) {
      endParagraph();
      list.push(line.slice(2).trim());
    } else {
      endList();
      paragraph.push(line);
    }
  }
  endParagraph();
  endList();

  return { title, updated, blocks };
}

/** Links may point only to the web, email, phone or this site. */
export function isSafeHref(href: string): boolean {
  return /^(https:\/\/|mailto:|tel:|\/(?!\/))/.test(href);
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) tokens.push({ type: 'text', text: text.slice(last, index) });
    const [whole, bold, label, href] = match;
    if (bold !== undefined) {
      tokens.push({ type: 'strong', text: bold });
    } else if (label !== undefined && href !== undefined && isSafeHref(href)) {
      tokens.push({ type: 'link', text: label, href });
    } else {
      tokens.push({ type: 'text', text: whole });
    }
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
}
