import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface SizeCapDialogItem {
  path: string;
  name: string;
  /** Dung lượng file NGUỒN — cũng là dự đoán dung lượng đầu ra của Hạng A/B/C
   * (xem `planSizeCap()`, `@tsmc/core-ingest`). */
  sourceBytes: number;
  /** Số phút ước tính nén lại, làm tròn LÊN từ duration thật — cùng cách tính
   * `GradeDDialogItem.estimateMin`. */
  estimateMin: number;
}

export interface SizeCapDialogData {
  items: SizeCapDialogItem[];
  maxUploadBytes: number;
}

/** Kết quả: `reencode` là tập `path` chọn "Nén lại". File KHÔNG có trong tập
 * (bỏ tick) bị bỏ qua lượt này — ở lại bảng metadata, không vào hàng đợi (cùng
 * cách `GradeDDialog` xử lý file bỏ tick). Cố ý KHÔNG có lựa chọn "thử upload
 * nguyên file": nó buộc hỏi lại lần hai sau remux, đúng thứ bước tiền kiểm này
 * sinh ra để tránh. */
export interface SizeCapDialogResult {
  reencode: string[];
}

/** Bước TIỀN KIỂM vượt trần upload (Giai đoạn 0, ADR-0017 § addendum
 * 2026-09-19 "kế hoạch") — hỏi MỘT LẦN cho cả batch, TRƯỚC khi bất kỳ file nào
 * bắt đầu xử lý, thay dialog cũ hỏi giữa batch (batch chạy lúc user vắng mặt
 * sẽ đứng chờ). Toggle riêng từng file, mặc định "Nén lại" (vừa trần sau MỘT
 * lần encode, không tốn thêm lượt remux); bỏ tick = bỏ qua file đó. Đóng dialog
 * bằng cách khác (Esc/bấm ra ngoài/"Huỷ upload") → `null`, `startUpload()` dừng
 * hẳn, mọi file còn nguyên trong bảng metadata — khác `GradeDDialog` (đóng =
 * chỉ bỏ các file D, batch vẫn chạy tiếp phần còn lại).
 * KHÔNG tự mở — luôn qua `DialogService.confirmSizeCap()`. */
@Component({
  selector: 'app-size-cap-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule],
  templateUrl: './size-cap-dialog.html',
  styleUrl: './size-cap-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SizeCapDialog {
  protected readonly data = inject<SizeCapDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<SizeCapDialog, SizeCapDialogResult>>(MatDialogRef);

  protected readonly maxGb = (this.data.maxUploadBytes / 1_000_000_000).toFixed(2);

  /** `path` → chọn "Nén lại". Mặc định TẤT CẢ chọn. */
  protected readonly checked = signal<ReadonlySet<string>>(new Set(this.data.items.map((i) => i.path)));

  protected isChecked(path: string): boolean {
    return this.checked().has(path);
  }

  protected toggle(path: string, value: boolean): void {
    this.checked.update((current) => {
      const next = new Set(current);
      if (value) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }

  protected gb(bytes: number): string {
    return (bytes / 1_000_000_000).toFixed(2);
  }

  protected onConfirm(): void {
    this.dialogRef.close({ reencode: [...this.checked()] });
  }
}
