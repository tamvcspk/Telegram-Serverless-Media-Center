import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless — ADR-0002/CLAUDE.md bắt buộc, không có zone.js trong dependency.
    provideZonelessChangeDetection(),
    // Hash-based routing (#/) — không phụ thuộc rewrite SPA của host. ADR-0012 §3.
    provideRouter(routes, withHashLocation()),
    // Material cần provider animations để không lỗi runtime; noop vì đây là
    // màn đăng nhập tối thiểu, chưa cần transition thật. @angular/animations
    // đã deprecated ở Angular 22 (khuyến khích animate.enter/leave) nhưng vẫn
    // được hỗ trợ — cân nhắc migrate khi F3 (UI thật) cần animation có chủ đích.
    provideNoopAnimations()
  ]
};
