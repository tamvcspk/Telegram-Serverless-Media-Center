import { ChangeDetectionStrategy, Component, EnvironmentInjector, OnInit, inject, runInInjectionContext } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DraftStore } from './core/draft-store';
import { QueueStore } from './core/queue-store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private readonly draftStore = inject(DraftStore);
  private readonly queueStore = inject(QueueStore);
  private readonly injector = inject(EnvironmentInjector);

  ngOnInit(): void {
    void this.guardWindowClose();
  }

  /** Đóng cửa sổ Tauri trực tiếp (nút X) KHÔNG đi qua Angular Router — guard
   * `canDeactivateWorkspace` (route `/workspace`) không thấy được sự kiện
   * này (ADR-0018 § "Quyết định kèm theo"), nên cần chặn riêng ở tầng cửa sổ
   * Tauri. Đăng ký MỘT LẦN ở root component (sống suốt vòng đời app, không
   * cần `DestroyRef.onDestroy()`) — hoạt động cho MỌI route, không chỉ lúc
   * đang ở `/workspace` (`DraftStore`/`QueueStore` root-provided nên đọc
   * được từ đây dù `WorkspaceComponent` hiện không hề mounted).
   *
   * Pattern chặn-rồi-tự-đóng: `preventDefault()` trước, hỏi xác nhận, rồi tự
   * gọi `destroy()` (KHÔNG phải `close()`) nếu đồng ý — `close()` chỉ EMIT
   * LẠI chính sự kiện `closeRequested` (theo doc `@tauri-apps/api/window`:
   * "emits a closeRequested event... To force window close, use destroy()"),
   * `destroy()` mới thật sự đóng, không lặp lại sự kiện nên không cần cờ
   * chống lặp vô hạn.
   *
   * **Bug thật đã gặp + vá (2026-09-13):** wrapper `onCloseRequested()` của
   * `@tauri-apps/api/window` tự gọi `await this.destroy()` SAU KHI handler
   * chạy xong, NẾU handler không `preventDefault()` (đọc thẳng
   * `node_modules/@tauri-apps/api/window.js`) — nghĩa là chỉ CẦN đăng ký
   * listener này, MỌI lần đóng (kể cả không có draft/queue nào, nhánh
   * `return` sớm bên dưới) đều cần quyền `core:window:allow-destroy`.
   * `capabilities/default.json` trước đó chỉ có `core:default` (không gồm
   * quyền này) — user KHÔNG đóng được app nữa sau khi thêm guard này ở PR2,
   * lỗi console `"window.destroy not allowed"`. Vá bằng cách thêm quyền vào
   * `capabilities/default.json`, KHÔNG né bằng cách gọi API khác.
   *
   * `DialogService` (kéo theo `MatDialogModule`/`ConfirmDialog`) import ĐỘNG
   * (`import()`), KHÔNG static ở đầu file — `App` là root component, nằm
   * trong bundle EAGER cho MỌI route; import static sẽ kéo toàn bộ Angular
   * Material Dialog vào bundle chính dù màn Đăng nhập/Chọn kênh không bao
   * giờ cần nó, chỉ Workspace (đã lazy) mới cần. Phát hiện thật lúc build
   * PR2: `ng build` báo vượt budget 500KB (567KB) ngay sau khi thêm dòng
   * `inject(DialogService)` tĩnh ở đây — import động khôi phục lại đúng
   * ranh giới lazy cũ. */
  private async guardWindowClose(): Promise<void> {
    const appWindow = getCurrentWindow();

    await appWindow.onCloseRequested(async (event) => {
      const draftCount = this.draftStore.items().length;
      const activeCount = this.queueStore.items().filter((item) => item.stage !== 'done' && item.stage !== 'error').length;
      if (draftCount === 0 && activeCount === 0) {
        return;
      }

      event.preventDefault();

      const parts: string[] = [];
      if (draftCount > 0) {
        parts.push(`${draftCount} file nháp chưa upload`);
      }
      if (activeCount > 0) {
        parts.push(`${activeCount} tác vụ đang chạy`);
      }

      const { DialogService } = await import('./shared/dialog/dialog.service');
      const dialogService = runInInjectionContext(this.injector, () => inject(DialogService));
      const proceed = await dialogService.confirm({
        title: 'Đóng ứng dụng?',
        message: `Bạn đang có ${parts.join(' và ')}. Đóng ứng dụng sẽ dừng NGAY LẬP TỨC mọi tiến trình đang chạy (khác lúc điều hướng trong app, tiến trình KHÔNG chạy ngầm được nữa vì cả app thoát). Tiếp tục đóng?`,
        confirmText: 'Đóng ứng dụng',
        cancelText: 'Ở lại',
        tone: 'warn'
      });

      if (proceed) {
        await appWindow.destroy();
      }
    });
  }
}
