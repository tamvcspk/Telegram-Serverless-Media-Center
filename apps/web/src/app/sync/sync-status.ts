import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { countOutbox, getSyncMeta, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { from } from 'rxjs';

/**
 * Bảng trạng thái đồng bộ (F1.2/F1.3) — đọc thẳng IndexedDB qua liveQuery
 * (ADR-0007 "đường đọc"), KHÔNG qua RPC: Core Worker của tab leader là nơi
 * duy nhất ghi, nhưng mọi tab đọc chung một IndexedDB vật lý nên không cần
 * hỏi lại worker. "Đồng bộ ngay" là RPC ghi duy nhất ở màn này.
 */
@Component({
  selector: 'app-sync-status',
  imports: [DatePipe, MatButtonModule],
  templateUrl: './sync-status.html',
  styleUrl: './sync-status.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncStatus {
  private readonly client = createCoreWorkerClient();

  readonly meta = toSignal(from(liveQuery(() => getSyncMeta())), { initialValue: undefined });
  readonly pendingOutboxCount = toSignal(from(liveQuery(() => countOutbox())), { initialValue: 0 });
  readonly flushing = signal(false);
  readonly writingTest = signal(false);
  readonly actionError = signal<string | null>(null);

  async onForceFlush(): Promise<void> {
    this.flushing.set(true);
    this.actionError.set(null);
    try {
      await this.client.forceFlush();
    } catch (err) {
      // Trước đây lỗi ở đây rơi vào unhandled rejection — nút "làm như
      // không có gì xảy ra" là chính xác triệu chứng khiến bug worker kép
      // (xem worker-host/src/index.ts) không ai phát hiện được từ UI.
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.flushing.set(false);
    }
  }

  /**
   * Chưa có UI nào của Epic 3/4 (progress/collection/settings thật) gọi
   * mutate() — không có gì để đẩy vào outbox thì "Đồng bộ ngay" luôn no-op,
   * không tự nói lên được đường ghi có chạy đúng hay không. Nút này ghi
   * MỘT sự kiện settings.set thật (khoá `syncTest`, giá trị = thời điểm
   * bấm) để tự kiểm — xoá khi Epic 3/4 có sự kiện thật để dùng thay thế.
   */
  async onWriteTestEvent(): Promise<void> {
    this.writingTest.set(true);
    this.actionError.set(null);
    try {
      await this.client.setSetting('syncTest', new Date().toISOString());
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.writingTest.set(false);
    }
  }
}
