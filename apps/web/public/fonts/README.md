# Fonts

Khand (700) and Hind (400, 600) by Indian Type Foundry, from Google Fonts, served from
this folder (ADR-033). Licensed under the SIL Open Font License 1.1: see `OFL-khand.txt`
and `OFL-hind.txt`.

| File | Family | Weight | Subset |
|---|---|---|---|
| `khand-700-latin.v1.woff2` | Khand | 700 | latin |
| `khand-700-latin-ext.v1.woff2` | Khand | 700 | latin-ext |
| `khand-700-devanagari.v1.woff2` | Khand | 700 | devanagari |
| `hind-400-latin.v1.woff2` | Hind | 400 | latin |
| `hind-400-latin-ext.v1.woff2` | Hind | 400 | latin-ext |
| `hind-400-devanagari.v1.woff2` | Hind | 400 | devanagari |
| `hind-600-latin.v1.woff2` | Hind | 600 | latin |
| `hind-600-latin-ext.v1.woff2` | Hind | 600 | latin-ext |
| `hind-600-devanagari.v1.woff2` | Hind | 600 | devanagari |

- `@font-face` rules and unicode ranges: `apps/web/src/styles/fonts.css`.
- Preloads per language: `apps/web/src/app/[locale]/layout.tsx`.
- Files are cached for a year (`next.config.ts` headers). When a file changes, bump its
  version in the name (`v1` → `v2`) and update both places above.
