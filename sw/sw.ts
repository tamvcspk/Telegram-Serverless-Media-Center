/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Build riêng bằng esbuild + workbox-build injectManifest, KHÔNG dùng
// @angular/service-worker (ngsw không cho fetch handler tuỳ biến) — ADR-0012 §1.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/_stream/')) {
    return;
  }

  // Stream proxy thật thuộc Epic 4 / ADR-0005: parse Range, hỏi Core Worker
  // qua MessageChannel, không bao giờ tự mở kết nối MTProto (ADR-0004).
  // Tham khảo cách parse Range đã kiểm chứng ở spike/sw.js khi triển khai thật.
  event.respondWith(
    new Response('Stream proxy chưa triển khai.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  );
});

// KHÔNG tự skipWaiting() — chiến lược cập nhật ADR-0012 §5: chờ người dùng
// xác nhận "Có bản mới, tải lại" thay vì cắt ngang luồng đang phát.
