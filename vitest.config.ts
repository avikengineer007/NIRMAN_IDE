import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'evals/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@nirman/model': path.resolve(__dirname, 'packages/model/src/index.ts'),
      '@nirman/tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@nirman/sandbox': path.resolve(__dirname, 'packages/sandbox/src/index.ts'),
      '@nirman/artifacts': path.resolve(__dirname, 'packages/artifacts/src/index.ts'),
      '@nirman/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@nirman/security': path.resolve(__dirname, 'packages/security/src/index.ts'),
      '@nirman/browser': path.resolve(__dirname, 'packages/browser/src/index.ts'),
      '@nirman/deploy': path.resolve(__dirname, 'packages/deploy/src/index.ts'),
      '@nirman/server': path.resolve(__dirname, 'packages/server/src/index.ts'),
      '@nirman/eval': path.resolve(__dirname, 'evals/src/index.ts'),
    },
  },
});
