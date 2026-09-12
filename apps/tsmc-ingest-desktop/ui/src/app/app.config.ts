import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless — ADR-0002/CLAUDE.md bắt buộc, không có zone.js trong dependency.
    provideZonelessChangeDetection(),
    // Không cần withHashLocation() như apps/web — trang này nạp trực tiếp từ
    // đĩa qua Tauri (frontendDist), không phải static host cần rewrite SPA.
    provideRouter(routes),
    // ĐỔI từ `provideNoopAnimations()` (2026-09-12) — phát hiện thật: Material
    // tự thêm class `_mat-animation-noopable` khi app dùng noop animations,
    // ép `animation: none !important` lên CHÍNH animation của
    // `mat-progress-spinner` mode="indeterminate" (không chỉ tắt transition
    // trang trí như tưởng lúc đầu — với spinner, animation LÀ nội dung, không
    // phải hiệu ứng phụ) — vòng xoay hàng đợi (workspace.ts) đứng yên vì lý
    // do này, không phải bug ở code của app. `provideAnimationsAsync()` tải
    // animation engine LƯỜI (chunk riêng, không chặn lần vẽ đầu) — vẫn nhẹ
    // cho một công cụ desktop nội bộ, không cần `provideAnimations()` (eager).
    provideAnimationsAsync()
  ]
};
