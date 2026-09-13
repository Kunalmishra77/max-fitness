// Flat ESLint config for the whole monorepo.
// Dependency rules come from docs/05-engineering/folder-structure.md and are enforced
// twice: by package specifier (no-restricted-imports) and by resolved path
// (import-x/no-restricted-paths), so neither `@mfp/x` nor `../../x` can slip through.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

/** Packages each workspace is forbidden to import. */
const FORBIDDEN = {
  // packages/shared is the leaf: no internal dependencies at all.
  shared: ['@mfp/core', '@mfp/core/*', '@mfp/db', '@mfp/db/*', '@mfp/integrations', '@mfp/integrations/*', '@mfp/config'],
  // packages/core depends on shared only. It defines ports; it never reaches for an implementation.
  core: ['@mfp/db', '@mfp/db/*', '@mfp/integrations', '@mfp/integrations/*', '@mfp/config'],
  // packages/db depends on shared, plus the core port interfaces it implements (ADR-017).
  db: ['@mfp/integrations', '@mfp/integrations/*', '@mfp/config'],
  // packages/integrations depends on shared and core/ports only — never on Prisma (ADR-017).
  integrations: ['@mfp/db', '@mfp/db/*', '@mfp/config', '@prisma/client'],
};

/** Apps are never importable from a package. */
const APP_PATHS = ['./apps/web', './apps/worker'];

const restrict = (paths, message) => ({
  'no-restricted-imports': ['error', { patterns: paths.map((p) => ({ group: [p], message })) }],
});

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/generated/**',
      '**/prisma/migrations/**',
      'apps/kiosk-android/**',
      // MediaPipe's WASM runtime, copied from node_modules at dev/build time.
      'apps/web/public/mediapipe/**',
      'apps/web/e2e/fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Root-level TS config files belong to no package tsconfig.
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': {
        typescript: { alwaysTryTypes: true, project: ['./*/*/tsconfig.json'] },
      },
    },
    rules: {
      // coding-standards.md §2: no `any`, no non-null assertions outside tests.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Packages must never import an app.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './packages', from: APP_PATHS, message: 'Packages must never import from apps.' },
            {
              target: './packages/shared/src',
              from: ['./packages/core', './packages/db', './packages/integrations'],
              message: 'packages/shared is a leaf: it must have no internal dependencies.',
            },
            {
              target: './packages/core/src',
              from: ['./packages/db', './packages/integrations'],
              message: 'packages/core depends on shared only. Define a port instead (ADR-017).',
            },
            {
              target: './packages/db/src',
              from: ['./packages/integrations'],
              message: 'packages/db must not depend on integrations.',
            },
            {
              target: './packages/integrations/src',
              from: ['./packages/db', './packages/core/src'],
              except: ['./ports'],
              message: 'packages/integrations may use core ports only, never Prisma (ADR-017).',
            },
          ],
        },
      ],
    },
  },

  // ── Per-package dependency boundaries, by specifier ──────────────────────
  {
    files: ['packages/shared/**/*.ts'],
    rules: restrict(FORBIDDEN.shared, 'packages/shared is a leaf: no internal dependencies (folder-structure.md).'),
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: restrict(FORBIDDEN.core, 'packages/core depends on @mfp/shared only. Define a port instead (ADR-017).'),
  },
  {
    files: ['packages/db/**/*.ts'],
    rules: restrict(FORBIDDEN.db, 'packages/db depends on @mfp/shared and @mfp/core ports only.'),
  },
  {
    files: ['packages/integrations/**/*.ts'],
    rules: restrict(
      FORBIDDEN.integrations,
      'packages/integrations depends on @mfp/shared and @mfp/core ports only — never on Prisma (ADR-017).',
    ),
  },

  // ── Domain code must not read the wall clock (CLAUDE.md §2.2) ────────────
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['packages/core/**/*.test.ts', 'packages/core/**/testing/**'],
    rules: {
      // Ban reading the wall clock — `new Date()` with no arguments and `Date.now()` —
      // while still allowing instant arithmetic such as `new Date(ms)`.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject a Clock. Business dates come from packages/shared/time (CLAUDE.md §2.2).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject a Clock (CLAUDE.md §2.2).',
        },
      ],
    },
  },

  // ── Tests ────────────────────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },

  // ── Scripts and seeds print to stdout on purpose ─────────────────────────
  {
    files: [
      'packages/db/seed/**/*.ts',
      'packages/db/scripts/**/*.ts',
      'packages/config/scripts/**/*.ts',
      'apps/worker/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  // ── Plain JavaScript config files: not part of any TS project ────────────
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // ── Config files ─────────────────────────────────────────────────────────
  {
    files: ['**/*.config.ts', '**/*.config.mjs', '**/*.config.js'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
);
