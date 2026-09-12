import { Routes } from '@angular/router';

// Ba route thật ở slice này — Đăng nhập + Chọn kênh + Workspace ba vùng
// (docs/ux-design.md § Phụ lục A.4/A.3, workspace mới chỉ có vùng HÀNG ĐỢI,
// xem doc comment ở workspace/workspace.ts). Hai màn còn lại của phụ lục
// (Trình quản lý catalog, Nhật ký) chưa có route — thêm route lazy riêng cho
// từng màn khi tới lượt, không dựng khung layout chung trước khi có ≥2 màn
// cần dùng chung nó (rule-of-three, ui-conventions §1/§6).
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
    loadComponent: () => import('./workspace/workspace').then((m) => m.Workspace)
  }
];
