import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash-based routing (#/) — không phụ thuộc rewrite SPA của host. ADR-0012 §3.
    provideRouter(routes, withHashLocation())
  ]
};
