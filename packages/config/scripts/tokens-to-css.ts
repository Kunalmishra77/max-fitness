/**
 * Generates `apps/web/src/styles/tokens.css` from `docs/03-design/design-tokens.json`.
 *
 * DESIGN-BLUEPRINT.md is the source of truth for the visual language, and
 * coding-standards.md §5 forbids raw hex in components. So the tokens file is
 * mechanically translated into Tailwind v4 `@theme` variables rather than
 * hand-copied — a colour can then be changed in one JSON file and every surface
 * follows, and a reviewer can see the CSS is not editorialised.
 *
 * The generated file IS committed (the phase prompt asks for it), so a build never
 * depends on this script having run and a diff shows what actually changed.
 *
 *   pnpm tokens
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOKENS_PATH = join(repoRoot, 'docs', '03-design', 'design-tokens.json');
const OUTPUT_PATH = join(repoRoot, 'apps', 'web', 'src', 'styles', 'tokens.css');

/**
 * The token file mixes two shapes: `{"$value": "#14213D"}` under `color`, and bare
 * strings under `radius`, `space`, `font.lineHeight` and friends. Rather than
 * normalise the design file (it follows the DTCG draft for the parts that matter),
 * the reader accepts both.
 */
type TokenNode = string | number | { $value?: unknown; $description?: unknown } | Record<string, unknown>;

function valueOf(node: TokenNode): string | null {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node !== null && typeof node === 'object' && '$value' in node) {
    const v = (node as { $value: unknown }).$value;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return null;
}

function descriptionOf(node: TokenNode): string | null {
  if (node !== null && typeof node === 'object' && '$description' in node) {
    const d = (node as { $description: unknown }).$description;
    if (typeof d === 'string') return d;
  }
  return null;
}

/** `signboardRed` -> `signboard-red`, `displayXl` -> `display-xl`, `12` -> `12`. */
function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

interface Emitted {
  readonly variable: string;
  readonly value: string;
  readonly comment: string | null;
}

/**
 * Walk a token group and emit `--{prefix}-{path}` variables.
 *
 * Tailwind v4 gives meaning to certain prefixes inside `@theme`: `--color-*`
 * generates `bg-*`/`text-*`/`border-*` utilities, `--font-*` generates `font-*`,
 * `--spacing-*` generates padding and margin scales, and so on. The prefix map
 * below is what turns design tokens into usable classes rather than inert
 * variables.
 */
function walk(group: Record<string, TokenNode>, prefix: string, path: string[] = []): Emitted[] {
  const out: Emitted[] = [];

  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith('$') || key === 'meta') continue;

    const value = valueOf(node);
    if (value !== null) {
      const segments = [...path, key].map(kebab);
      out.push({
        variable: `--${prefix}-${segments.join('-')}`,
        value,
        comment: descriptionOf(node),
      });
      continue;
    }

    if (node !== null && typeof node === 'object') {
      out.push(...walk(node as Record<string, TokenNode>, prefix, [...path, key]));
    }
  }

  return out;
}

function block(title: string, note: string | null, entries: readonly Emitted[]): string {
  if (entries.length === 0) return '';
  const width = Math.max(...entries.map((e) => e.variable.length));
  const lines = entries.map((e) => {
    const padded = `${e.variable}:`.padEnd(width + 2);
    const comment = e.comment === null ? '' : ` /* ${e.comment} */`;
    return `  ${padded} ${e.value};${comment}`;
  });
  return [`  /* ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))} */`, ...(note === null ? [] : [`  /* ${note} */`]), ...lines, ''].join('\n');
}

function main(): void {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Record<string, TokenNode>;
  const meta = tokens['meta'] as { version?: string } | undefined;

  const colour = walk(tokens['color'] as Record<string, TokenNode>, 'color');
  const fontFamily = walk((tokens['font'] as Record<string, TokenNode>)['family'] as Record<string, TokenNode>, 'font');
  const fontSize = walk((tokens['font'] as Record<string, TokenNode>)['size'] as Record<string, TokenNode>, 'text');
  const lineHeight = walk(
    (tokens['font'] as Record<string, TokenNode>)['lineHeight'] as Record<string, TokenNode>,
    'leading',
  );
  const radius = walk(tokens['radius'] as Record<string, TokenNode>, 'radius');
  const space = walk(tokens['space'] as Record<string, TokenNode>, 'spacing');
  const size = walk(tokens['size'] as Record<string, TokenNode>, 'size');
  const shadow = walk(tokens['shadow'] as Record<string, TokenNode>, 'shadow');
  const duration = walk(
    (tokens['motion'] as Record<string, TokenNode>)['duration'] as Record<string, TokenNode>,
    'duration',
  );
  const easing = walk((tokens['motion'] as Record<string, TokenNode>)['easing'] as Record<string, TokenNode>, 'ease');
  const breakpoint = walk(tokens['breakpoint'] as Record<string, TokenNode>, 'breakpoint');

  const header = [
    '/*',
    ' * GENERATED FILE — DO NOT EDIT BY HAND.',
    ' *',
    ' * Source:    docs/03-design/design-tokens.json' + (meta?.version === undefined ? '' : ` (v${meta.version})`),
    ' * Generator: packages/config/scripts/tokens-to-css.ts',
    ' * Regenerate: pnpm tokens',
    ' *',
    ' * These become Tailwind v4 utilities: --color-* gives bg-/text-/border-,',
    ' * --text-* gives font sizes, --spacing-* the spacing scale, and so on.',
    ' * coding-standards.md §5: components use these utilities, never raw hex.',
    ' */',
    '',
    '@theme {',
  ].join('\n');

  const body = [
    block('Brand and semantic colour (DESIGN-BLUEPRINT §3)', null, colour),
    block('Type families (DESIGN-BLUEPRINT §4)', 'Loaded via next/font; the variables are set on <html>.', fontFamily),
    block('Type scale', null, fontSize),
    block('Line heights', 'Devanagari gets +10% at the same size — see --leading-devanagari-boost.', lineHeight),
    block('Radius by hierarchy (DESIGN-BLUEPRINT §5)', 'Not one radius everywhere: photos 2px, buttons 6px, panels 12px, modals 16px.', radius),
    block('Spacing scale', null, space),
    block('Sizes and touch targets', 'CRM targets are ≥56px and kiosk ≥72px (CLAUDE.md §2.10).', size),
    block('Shadows', 'Elevated overlays only; cards on Chalk use a 1px border instead.', shadow),
    block('Motion', 'Respect prefers-reduced-motion at the call site.', duration),
    block('Easing', null, easing),
    block('Breakpoints', 'Every screen must work at 360px (CLAUDE.md §2.10).', breakpoint),
  ]
    .filter((b) => b.length > 0)
    .join('\n');

  const css = `${header}\n${body}}\n`;

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, css, 'utf8');

  const count =
    colour.length +
    fontFamily.length +
    fontSize.length +
    lineHeight.length +
    radius.length +
    space.length +
    size.length +
    shadow.length +
    duration.length +
    easing.length +
    breakpoint.length;

  console.log(`Wrote apps/web/src/styles/tokens.css — ${count} tokens from design-tokens.json`);
}

main();
