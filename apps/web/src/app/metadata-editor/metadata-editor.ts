import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { getMediaItem, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { from } from 'rxjs';

type Compat = 'full' | 'partial' | 'unplayable';

/**
 * Ingest Editor (Màn hình 6, docs/ux-design.md) — sửa Title/Năm/Compat của
 * MỘT item rồi đóng gói lại TOÀN BỘ catalog.json của nguồn, ghim đè lên kênh
 * media (`client.saveMediaMetadata()`, xem worker-host/core-worker.ts +
 * core-index/publish-catalog.ts). CHỈ hợp lệ cho Kho Cá Nhân (ADR-0014 §4 —
 * kênh do chính tài khoản này tạo, `checkSourceWritable()`); kiểm tra NGAY
 * khi mở màn, không đợi tới lúc Lưu mới báo lỗi.
 *
 * Entry point (Browse row menu) KHÔNG lọc trước theo quyền ghi — mọi row đều
 * có nút này, kể cả với nguồn không phải của mình (sẽ thấy thông báo chặn ở
 * đây). Cùng triết lý "hoãn có chủ đích" như CLAUDE.md đã ghi cho các UX
 * tinh chỉnh tương tự (vd trạng thái chết link ở Collections) — lọc trước
 * cần một bước kiểm tra quyền hàng loạt ở Browse, chưa đáng làm cho một nút
 * ít dùng.
 */
@Component({
  selector: 'app-metadata-editor',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  templateUrl: './metadata-editor.html',
  styleUrl: './metadata-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetadataEditor {
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly client = createCoreWorkerClient();

  protected readonly sourceId = this.route.snapshot.paramMap.get('sourceId') ?? '';
  protected readonly msgId = Number(this.route.snapshot.paramMap.get('msgId') ?? '0');

  protected readonly item = toSignal(from(liveQuery(() => getMediaItem(this.sourceId, this.msgId))), { initialValue: undefined });

  /** `null` = đang kiểm tra. */
  protected readonly writable = signal<boolean | null>(null);

  protected readonly title = signal('');
  protected readonly year = signal<number | null>(null);
  protected readonly compat = signal<Compat | undefined>(undefined);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  // Chỉ nạp form từ `item()` ĐÚNG MỘT LẦN lúc dữ liệu về — liveQuery bắn lại
  // sau mỗi lần Save (Dexie vừa được re-scan/reindex), nạp lại lúc đó sẽ ghi
  // đè state đang gõ dở của user bằng chính giá trị vừa gửi đi (vô hại về
  // đúng/sai nhưng làm rớt focus/con trỏ đang gõ — trải nghiệm tệ không cần
  // thiết).
  private formSeeded = false;

  constructor() {
    void this.checkWritable();
    effect(() => {
      const record = this.item();
      if (record && !this.formSeeded) {
        this.formSeeded = true;
        this.title.set(record.title ?? '');
        this.year.set(record.year ?? null);
        this.compat.set(record.compat);
      }
    });
  }

  private async checkWritable(): Promise<void> {
    try {
      this.writable.set(await this.client.checkSourceWritable(this.sourceId));
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : String(err));
      this.writable.set(false);
    }
  }

  onTitleInput(value: string): void {
    this.title.set(value);
  }

  onYearInput(value: string): void {
    this.year.set(value ? Number(value) : null);
  }

  onCompatChange(value: Compat): void {
    this.compat.set(value);
  }

  async onSave(): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const title = this.title().trim();
      await this.client.saveMediaMetadata(this.sourceId, this.msgId, {
        title: title.length > 0 ? title : undefined,
        year: this.year() ?? undefined,
        compat: this.compat()
      });
      this.close();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.location.back();
  }
}
