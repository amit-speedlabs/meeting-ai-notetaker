import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(import.meta.dirname), 'server-only': path.resolve(import.meta.dirname, 'tests/server-only-stub.ts') } },
});
