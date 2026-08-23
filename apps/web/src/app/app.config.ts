import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless — ADR-0002/CLAUDE.md bắt buộc, không có zone.js trong dependency.
    provideZonelessChangeDetection(),
    // Hash-based routing (#/) — không phụ thuộc rewrite SPA của host. ADR-0012 §3.
    provideRouter(routes, withHashLocation())
  ]
};
