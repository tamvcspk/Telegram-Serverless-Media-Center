import { defineConfig } from 'vitest/config';

// Chạy riêng khỏi Angular test builder của apps/web — chứng minh libs/core-*
// test được bằng Node thuần, không cần Angular/Karma (ADR-0012 §2).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['*/src/**/*.spec.ts']
  }
});
