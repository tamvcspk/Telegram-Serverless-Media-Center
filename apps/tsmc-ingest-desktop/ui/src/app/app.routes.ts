import { Routes } from '@angular/router';

// Chỉ một route thật ở slice này — Đăng nhập (docs/ux-design.md § Phụ lục
// A.4, hàng "Đăng nhập"). Các màn còn lại của phụ lục (Chọn kênh, Trình quản
// lý catalog, Nhật ký, workspace ba vùng A.3) chưa có route — thêm route lazy
// riêng cho từng màn khi tới lượt, không dựng khung layout chung trước khi
// có ≥2 màn cần dùng chung nó (rule-of-three, ui-conventions §1/§6).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login)
  }
];
