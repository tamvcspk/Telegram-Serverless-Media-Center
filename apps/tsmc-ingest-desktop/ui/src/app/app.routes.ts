import { Routes } from '@angular/router';
import { canDeactivateWorkspace } from './workspace/workspace-deactivate.guard';

// Sáu route thật ở slice này — Đăng nhập + Chọn kênh + Workspace ba vùng +
// Cài đặt + Trình quản lý catalog + Nhật ký (docs/ux-design.md § Phụ lục
// A.4/A.3, workspace mới chỉ có vùng HÀNG ĐỢI, xem doc comment ở
// workspace/workspace.ts) — đủ cả 5 màn A.4 gốc cộng "Cài đặt" thêm mới.
// "Cài đặt" KHÔNG có trong mockup A.4 gốc — thêm theo gap
// docs/roadmap.md § Ingest ("Màn Settings — chưa có"), vào qua icon ⚙ ở
// topbar Workspace. "Trình quản lý catalog"/"Nhật ký" vào qua icon riêng
// cạnh ⚙ ở cùng topbar.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login)
  },
  {
    path: 'channel',
    loadComponent: () => import('./channel/channel').then((m) => m.Channel)
  },
  {
    path: 'workspace',
    loadComponent: () => import('./workspace/workspace').then((m) => m.Workspace),
    // Cảnh báo mất Draft/Queue trước khi rời màn (ADR-0018) — CHỈ chặn điều
    // hướng trong app, xem doc comment ở workspace-deactivate.guard.ts. Áp
    // dụng cho MỌI điều hướng rời khỏi route này, kể cả sang /settings —
    // nhất quán với "Chọn kênh khác" (không có ngoại lệ riêng cho lối rẽ tạm).
    canDeactivate: [canDeactivateWorkspace]
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings').then((m) => m.Settings)
  },
  {
    path: 'catalog',
    loadComponent: () => import('./catalog-manager/catalog-manager').then((m) => m.CatalogManager)
  },
  {
    path: 'logs',
    loadComponent: () => import('./logs/logs').then((m) => m.Logs)
  }
];
