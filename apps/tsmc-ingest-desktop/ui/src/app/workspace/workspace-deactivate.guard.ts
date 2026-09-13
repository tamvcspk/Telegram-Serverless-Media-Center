import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { DraftStore } from '../core/draft-store';
import { QueueStore } from '../core/queue-store';
import type { Workspace } from './workspace';

/** Cảnh báo mất Draft/Queue khi rời Workspace (ADR-0018 § "Quyết định kèm
 * theo") — thuần vấn đề "ngăn mất dữ liệu UI", KHÔNG liên quan ADR-0014 (đã
 * cân nhắc và loại bỏ viện dẫn đó lúc thiết kế — ranh giới kênh state/media
 * không dính tới quyết định này).
 *
 * CHỈ chặn điều hướng TRONG APP (Angular Router gọi guard này). Đóng cửa sổ
 * Tauri trực tiếp (nút X) KHÔNG đi qua đây — xem `onCloseRequested` đăng ký
 * riêng ở `app.ts`, cùng logic cảnh báo nhưng cơ chế chặn khác hẳn (Router
 * không thấy được sự kiện đóng cửa sổ). */
export const canDeactivateWorkspace: CanDeactivateFn<Workspace> = async () => {
  const draftStore = inject(DraftStore);
  const queueStore = inject(QueueStore);
  // Bắt buộc lấy NGAY, ĐỒNG BỘ (trước bất kỳ `await` nào) — `inject()` chỉ
  // hợp lệ trong injection context Router dựng lúc gọi guard; sau `await
  // import()` bên dưới đã ra khỏi context đó, phải tự khôi phục bằng
  // `runInInjectionContext(injector, ...)`.
  const injector = inject(EnvironmentInjector);

  const draftCount = draftStore.items().length;
  // "Đang chạy" = còn tác vụ CHƯA xong/lỗi — dòng done/error không cần cảnh
  // báo gì thêm (đã ở trạng thái cuối, không mất gì nếu rời màn).
  const activeCount = queueStore.items().filter((item) => item.stage !== 'done' && item.stage !== 'error').length;

  if (draftCount === 0 && activeCount === 0) {
    return true;
  }

  const parts: string[] = [];
  if (draftCount > 0) {
    parts.push(`${draftCount} file nháp chưa upload`);
  }
  if (activeCount > 0) {
    parts.push(`${activeCount} tác vụ đang chạy`);
  }

  // Import ĐỘNG (không static ở đầu file) — `app.routes.ts` nạp guard này
  // EAGER (route config, không qua `loadComponent`), static import
  // `DialogService` sẽ kéo `MatDialogModule`/`ConfirmDialog` vào bundle
  // chính dù màn Đăng nhập/Chọn kênh không bao giờ cần (cùng lý do đã vá ở
  // `app.ts::guardWindowClose()` — xem doc comment ở đó).
  const { DialogService } = await import('../shared/dialog/dialog.service');
  const dialogService = runInInjectionContext(injector, () => inject(DialogService));

  const proceed = await dialogService.confirm({
    title: 'Rời khỏi Workspace?',
    message:
      `Bạn đang có ${parts.join(' và ')}. Rời khỏi màn này sẽ XOÁ các bản nháp chưa upload` +
      (activeCount > 0 ? ' — tác vụ đang chạy vẫn tiếp tục ngầm, hiện lại đúng khi quay lại kênh này.' : '.') +
      ' Tiếp tục?',
    confirmText: 'Rời khỏi',
    cancelText: 'Ở lại',
    tone: 'warn'
  });

  if (proceed) {
    // Chỉ Draft bị xoá — QueueStore CỐ Ý giữ nguyên (ADR-0018 mục 6): tiến
    // trình Rust của batch đang chạy không hề biết/quan tâm route Angular
    // đang ở đâu, và `QueueStore` (root-provided) sống xuyên route nên
    // remount lại đúng kênh này sau đó vẫn thấy đúng tiến trình thật.
    draftStore.clear();
  }
  return proceed;
};
