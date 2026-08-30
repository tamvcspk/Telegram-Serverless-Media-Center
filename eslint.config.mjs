// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import boundaries from 'eslint-plugin-boundaries';

// Ranh giới phụ thuộc ADR-0012 §2, ép bằng lint chứ không phải thoả thuận
// miệng (CLAUDE.md). Loại phần tử: app (web), app-ingest (tsmc-ingest CLI),
// lib-mtproto, lib-download, lib-core (index/search/sync/storage/worker-host
// /ingest), lib-shared (shared-models).
//
// `app-ingest` KHÔNG được gộp vào `app` — policy "app không import lib-mtproto
// trực tiếp" (dưới đây) đúng cho web (phải qua worker-host, ADR-0012 §2) NHƯNG
// sai cho CLI: tsmc-ingest chạy ngoài trình duyệt, không có worker-host để đi
// qua, cần import @tsmc/core-mtproto thẳng (giống cách worker-host đang làm).
const boundariesElements = [
  { type: 'app', pattern: 'apps/web/src/**' },
  { type: 'app-ingest', pattern: 'apps/tsmc-ingest/src/**' },
  { type: 'lib-mtproto', pattern: 'libs/core-mtproto/src/**' },
  { type: 'lib-download', pattern: 'libs/core-download/src/**' },
  {
    type: 'lib-core',
    pattern: [
      'libs/core-index/src/**',
      'libs/core-ingest/src/**',
      'libs/core-search/src/**',
      'libs/core-sync/src/**',
      'libs/core-storage/src/**',
      'libs/worker-host/src/**'
    ]
  },
  { type: 'lib-shared', pattern: 'libs/shared-models/src/**' }
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      '**/out-tsc/**',
      'apps/web/public/**',
      'spike/**'
    ]
  },
  {
    // Cho eslint-plugin-boundaries phân giải import '@tsmc/*' về đúng file
    // thật qua path alias — không có bước này nó không nhận ra target,
    // rule boundaries/dependencies coi như "không phân loại được" và luôn allow.
    settings: {
      'import/resolver': {
        typescript: { project: 'tsconfig.base.json' }
      }
    }
  },
  {
    files: ['apps/web/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    plugins: { boundaries },
    settings: { 'boundaries/elements': boundariesElements },
    rules: {
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'app' } },
              disallow: { to: { element: { types: { anyOf: ['lib-mtproto', 'lib-download'] } } } },
              message:
                'apps/web không được import core-mtproto/core-download trực tiếp — chỉ qua worker-host (ADR-0012 §2, CLAUDE.md bất biến #4).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/web/src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {}
  },
  {
    // CLI Node thuần (tsmc-ingest) — không Angular, chưa khớp glob nào ở
    // trên/dưới (apps/web/src/** hay libs/**) nên cần block riêng, nếu không
    // sẽ không được lint gì cả.
    files: ['apps/tsmc-ingest/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { boundaries },
    settings: { 'boundaries/elements': boundariesElements }
  },
  {
    files: ['libs/**/*.ts', 'sw/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { boundaries },
    settings: { 'boundaries/elements': boundariesElements },
    rules: {
      // libs/core-* không được phụ thuộc Angular — lõi phải test được bằng
      // Node thuần (ADR-0012 §2). core-storage vẫn được dùng `dexie` bình
      // thường vì rule này chỉ chặn riêng @angular/*.
      'no-restricted-imports': ['error', { patterns: [{ group: ['@angular/*'], message: 'libs/core-* không được phụ thuộc @angular/* (ADR-0012 §2).' }] }],
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'lib-shared' } },
              disallow: {
                to: { element: { types: { anyOf: ['app', 'lib-mtproto', 'lib-download', 'lib-core'] } } }
              },
              message: 'shared-models không được phụ thuộc bất cứ package nào khác trong repo (ADR-0012 §2).'
            }
          ]
        }
      ]
    }
  }
);
