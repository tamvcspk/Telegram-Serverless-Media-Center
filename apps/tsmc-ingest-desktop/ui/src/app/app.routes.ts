import { Routes } from '@angular/router';
import { canDeactivateWorkspace } from './workspace/workspace-deactivate.guard';

// Bốn route thật ở slice này — Đăng nhập + Chọn kênh + Workspace ba vùng +
// Cài đặt (docs/ux-design.md § Phụ lục A.4/A.3, workspace mới chỉ có vùng
// HÀNG ĐỢI, xem doc comment ở workspace/workspace.ts). "Cài đặt" KHÔNG có
// trong mockup A.4 gốc — thêm theo gap docs/roadmap.md § Ingest ("Màn
// Settings — chưa có"), vào qua icon ⚙ ở topbar Workspace. Hai màn còn lại
// của phụ lục A.4 (Trình quản lý catalog, Nhật ký) vẫn chưa có route — thêm
// route lazy riêng cho từng màn khi tới lượt, không dựng khung layout chung
// trước khi có ≥2 màn cần dùng chung nó (rule-of-three, ui-conventions §1/§6).
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
  }
];
