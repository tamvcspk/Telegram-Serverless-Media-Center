import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * Layout "Main shell" (ui-conventions §6, Màn hình 2/3/4 docs/ux-design.md) —
 * Bottom Navigation Bar cho 3 tab chính (Home/BST/Nguồn). KHÔNG dùng
 * `MatBottomNav` — component đó không tồn tại trong Angular Material (đã
 * xác nhận bằng cách liệt kê thư mục cài đặt thật, xem ADR-0016 addendum +
 * ux-design.md phần "Nguyên tắc chuyển đổi Mobile-First"), nên tự ghép bằng
 * `routerLink` + `routerLinkActive` thường, không phải import module Material
 * nào cho việc này.
 */
@Component({
  selector: 'app-main-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './main-shell.html',
  styleUrl: './main-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MainShell {}
