import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { filter, map, startWith } from 'rxjs';
import { pageTitleOverride } from './page-title';

interface LeafRouteData {
  title: string;
  /** Route lồng (vd Collection detail) khai field này để MainShell hiện nút back bên trái toolbar — 3 tab cấp cao không khai nên không có nút back. */
  backTo: string | null;
}

function readLeafRouteData(router: Router): LeafRouteData {
  let route = router.routerState.snapshot.root;
  while (route.firstChild) {
    route = route.firstChild;
  }
  const title = route.data['title'];
  const backTo = route.data['backTo'];
  return {
    title: typeof title === 'string' ? title : '',
    backTo: typeof backTo === 'string' ? backTo : null
  };
}

/**
 * Layout "Main shell" (ui-conventions §6, Màn hình 2/3/4 docs/ux-design.md) —
 * Bottom Navigation Bar cho 3 tab chính (Home/BST/Nguồn). KHÔNG dùng
 * `MatBottomNav` — component đó không tồn tại trong Angular Material (đã
 * xác nhận bằng cách liệt kê thư mục cài đặt thật, xem ADR-0016 addendum +
 * ux-design.md phần "Nguyên tắc chuyển đổi Mobile-First"), nên tự ghép bằng
 * `routerLink` + `routerLinkActive` thường, không phải import module Material
 * nào cho việc này.
 *
 * `MatToolbar` (lần đầu dùng trong repo) hiển thị tiêu đề trang đổi theo
 * route con đang active — đọc `data.title` ở leaf route mỗi khi
 * `NavigationEnd` bắn, hoặc `pageTitleOverride` (shell/page-title.ts) nếu
 * trang con set giá trị động (vd Collection detail — tên BST chỉ biết sau
 * khi liveQuery resolve). Nút Cài đặt giờ nằm ở đây thay vì riêng Browse —
 * vào được từ cả 3 tab. `backTo` (cùng nguồn `data` với `title`) cho nút back
 * bên trái toolbar ở route lồng (vd `collections/:id`) — 3 tab cấp cao
 * không khai field này nên không hiện nút back.
 */
@Component({
  selector: 'app-main-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule],
  templateUrl: './main-shell.html',
  styleUrl: './main-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MainShell {
  private readonly router = inject(Router);

  private readonly leafRouteData = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => readLeafRouteData(this.router)),
      startWith(readLeafRouteData(this.router))
    ),
    { initialValue: readLeafRouteData(this.router) }
  );

  protected readonly title = computed(() => pageTitleOverride() ?? this.leafRouteData().title);
  protected readonly backTo = computed(() => this.leafRouteData().backTo);
}
