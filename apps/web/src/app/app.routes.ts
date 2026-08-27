import { Routes } from '@angular/router';
import { authGuard } from './shell/auth.guard';

// Skeleton routing theo ui-conventions §6 — 4 nhóm layout khác nhau, KHÔNG
// bọc chung một AppShell:
//   - 'login'        : Auth, full-bleed, không cha layout.
//   - 'home' + con    : Main shell (MainShell, Bottom Nav), gate bằng
//                       authGuard — nơi DUY NHẤT gọi initSync() (xem
//                       shell/auth.guard.ts).
//   - 'player/...'    : Immersive, không cha layout (đã có từ F4).
// Route Settings/Metadata Editor (sub-page, Màn hình 6/7) chưa thêm — chưa
// có UI thật để route tới (xem CLAUDE.md).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login)
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/main-shell').then((m) => m.MainShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'browse' },
      { path: 'browse', loadComponent: () => import('./browse/browse').then((m) => m.Browse) },
      { path: 'collections', loadComponent: () => import('./collections/collections').then((m) => m.Collections) },
      { path: 'sources', loadComponent: () => import('./sources/sources').then((m) => m.Sources) }
    ]
  },
  {
    path: 'player/:sourceId/:msgId',
    loadComponent: () => import('./player/player').then((m) => m.Player)
  }
];
