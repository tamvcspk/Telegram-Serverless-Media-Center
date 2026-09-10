import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless — ADR-0002/CLAUDE.md bắt buộc, không có zone.js trong dependency.
    provideZonelessChangeDetection(),
    // Không cần withHashLocation() như apps/web — trang này nạp trực tiếp từ
    // đĩa qua Tauri (frontendDist), không phải static host cần rewrite SPA.
    provideRouter(routes),
    // Material cần provider animations để không lỗi runtime; noop vì đây là
    // công cụ desktop tối thiểu, chưa cần transition thật.
    provideNoopAnimations()
  ]
};
