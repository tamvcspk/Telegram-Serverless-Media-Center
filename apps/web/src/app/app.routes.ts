import { Routes } from '@angular/router';
import { authGuard } from './shell/auth.guard';

// Skeleton routing theo ui-conventions §6 — 4 nhóm layout khác nhau, KHÔNG
// bọc chung một AppShell:
//   - 'login'        : Auth, full-bleed, không cha layout.
//   - 'home' + con    : Main shell (MainShell, Bottom Nav), gate bằng
//                       authGuard — nơi DUY NHẤT gọi initSync() (xem
//                       shell/auth.guard.ts).
//   - 'player/...'    : Immersive, không cha layout (đã có từ F4).
//   - 'settings'      : Sub-page (Màn hình 7), header quay lại, KHÔNG dưới
//                       'home' (không thuộc Bottom Nav — vào qua icon ⚙️ ở
//                       Browse). Vẫn gate bằng authGuard: cần session để
//                       hiển thị tài khoản, và syncEngine phải đã init() để
//                       forceFlush()/setMaxConcurrency() (trong onLogout/
//                       onConcurrencyChange) không ném "gọi trước init()"
//                       nếu user vào thẳng /settings bằng URL mà chưa từng
//                       qua /home trong tab này.
//   - 'metadata/...'  : Sub-page (Màn hình 6, Ingest Editor), cùng nhóm với
//                       'settings' — header quay lại, KHÔNG Bottom Nav, vào
//                       qua nút "✏️" trên mỗi row của Browse. authGuard cùng
//                       lý do: cần session, và saveMediaMetadata() gọi
//                       gateway.resolveIndexChannel() qua Core Worker chứ
//                       không qua syncEngine, nhưng vẫn cần session hợp lệ.
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
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./settings/settings').then((m) => m.Settings)
  },
  {
    path: 'metadata/:sourceId/:msgId',
    canActivate: [authGuard],
    loadComponent: () => import('./metadata-editor/metadata-editor').then((m) => m.MetadataEditor)
  },
  {
    path: 'player/:sourceId/:msgId',
    loadComponent: () => import('./player/player').then((m) => m.Player)
  }
];
