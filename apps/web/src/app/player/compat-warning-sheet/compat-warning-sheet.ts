import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';

export interface CompatWarningSheetData {
  compat: 'partial' | 'unplayable';
  /** null nếu không resolve được nguồn (đã gỡ) — ẩn hẳn nút "Mở trên Telegram" thay vì trỏ tới link chết. */
  deepLink: string | null;
}

const WARNING_TEXT: Record<CompatWarningSheetData['compat'], string> = {
  partial: 'Phim này dùng định dạng trình duyệt web hỗ trợ MỘT PHẦN (vd: chỉ nghe được tiếng, không có hình).',
  unplayable: 'Phim này dùng định dạng (vd: MKV, codec hiếm) trình duyệt web nhiều khả năng KHÔNG phát được — màn hình có thể đen ngòm.'
};

/**
 * MatBottomSheet cảnh báo tương thích (Màn hình 5, docs/ux-design.md) — chặn
 * NGAY trước khi gắn `src` cho `<video>` khi catalog đã gán nhãn
 * `compat: 'partial' | 'unplayable'` (Ingest Editor, Màn hình 6 — chưa route,
 * nhưng field đã có thật trong `CatalogItemV1`/`MediaRecord` từ catalog.json
 * cộng đồng, xem `libs/core-index/src/catalog-tier.ts`). `compat` undefined
 * (tuyệt đại đa số item hiện tại, chưa ai gán nhãn) KHÔNG hiện sheet này —
 * "chưa biết" khác "đã biết là có vấn đề", nagging mọi item sẽ vô nghĩa.
 * `disableClose: true` — mockup chỉ có đúng 2 lựa chọn tường minh, không có
 * nút Huỷ/backdrop-tap ngầm định nào khác.
 */
@Component({
  selector: 'app-compat-warning-sheet',
  imports: [MatButtonModule],
  templateUrl: './compat-warning-sheet.html',
  styleUrl: './compat-warning-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CompatWarningSheet {
  private readonly sheetRef = inject(MatBottomSheetRef<CompatWarningSheet, 'play' | 'telegram'>);
  protected readonly data = inject<CompatWarningSheetData>(MAT_BOTTOM_SHEET_DATA);
  protected readonly warningText = WARNING_TEXT[this.data.compat];

  onOpenTelegram(): void {
    this.sheetRef.dismiss('telegram');
  }

  onPlayAnyway(): void {
    this.sheetRef.dismiss('play');
  }
}
