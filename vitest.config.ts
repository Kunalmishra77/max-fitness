import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest 5 replaced `vitest.workspace.ts` with `test.projects`.
// Unit tests must never touch a database (ADR-010); the integration project is
// separate and skips itself when TEST_DATABASE_URL is unset.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integrations',
          root: './packages/integrations',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'worker',
          root: './apps/worker',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          root: './packages/db',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          // Integration tests make many round trips to a remote database (ADR-010).
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Vite 8 transforms with Oxc. apps/web's tsconfig says `jsx: preserve` for Next,
        // so the tests spell out the automatic JSX runtime.
        oxc: { jsx: { runtime: 'automatic' } },
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'happy-dom',
          environmentOptions: { happyDOM: { url: 'http://localhost:3000' } },
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // packages/core carries the business rules: 80% lines is a release gate
      // (TRD §6 Maintainability, testing-strategy.md §1).
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/ports/**', '**/testing/**', '**/types.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
