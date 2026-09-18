import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { listSeriesNames, suggestNextEpisode } from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';

export interface AssignSeriesDialogData {
  /** Số dòng đang được gán — chỉ để hiện trong tiêu đề, không ảnh hưởng logic. */
  count: number;
  /** Gợi ý tên series MỚI — title của dòng ĐẦU TIÊN đã chọn (brainstorm
   * 2026-09-18: "tạo series từ ≥1 tập phim có thể điền sẵn form"). */
  suggestedName: string;
  /** Toàn bộ item ĐÃ BIẾT (bảng đang sửa GHÉP catalog đã publish, nếu tầng
   * gọi có — xem `workspace.ts`/`catalog-manager.ts`) — dialog tự tính
   * `listSeriesNames()`/`suggestNextEpisode()` từ đây, không cần tầng gọi
   * tính trước. */
  knownItems: CatalogItemV1[];
}

export interface AssignSeriesResult {
  seriesName: string;
  season: number;
  startEpisode: number;
  /** `true` nếu admin chọn series CÓ SẴN và tick "kế thừa" — tầng gọi tự
   * `findRepresentativeEpisode()` + `assignToSeries()` với item đại diện. */
  inheritFromExisting: boolean;
}

/**
 * "Thêm vào series" hàng loạt (brainstorm 2026-09-18) — gán N dòng đã chọn
 * (đang là phim lẻ) vào MỘT series, có sẵn hoặc mới tạo, season cố định +
 * episode tăng dần theo thứ tự đã chọn (tầng gọi tự cộng dồn
 * `startEpisode + index`, dialog chỉ trả giá trị BẮT ĐẦU).
 *
 * **Series có sẵn:** chọn từ danh sách (`listSeriesNames(data.knownItems)`)
 * — picker, không gõ tay, tránh lệch chữ hoa/thường tạo nhóm trùng lặp
 * trong `flattenMetadataTree()`. Chọn xong tự gợi ý season/episode kế tiếp
 * (`suggestNextEpisode()`) — admin sửa lại được. Có tuỳ chọn kế thừa
 * genres/cast/director từ tập đại diện của series đó.
 *
 * **Series mới:** ô nhập tay, pre-fill bằng `data.suggestedName` — season/
 * episode mặc định 1/1 (không có gì để kế thừa, không hiện checkbox kế
 * thừa).
 *
 * KHÔNG tự mở — luôn qua `DialogService.assignSeries()`. Đóng không bấm
 * "Gán" → `undefined` (cùng nguyên tắc "đóng không phải xác nhận = từ
 * chối" của `ConfirmDialog`).
 */
@Component({
  selector: 'app-assign-series-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  templateUrl: './assign-series-dialog.html',
  styleUrl: './assign-series-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AssignSeriesDialog {
  protected readonly data = inject<AssignSeriesDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<AssignSeriesDialog, AssignSeriesResult>>(MatDialogRef);

  protected readonly existingSeriesNames = listSeriesNames(this.data.knownItems);

  protected readonly mode = signal<'existing' | 'new'>(this.existingSeriesNames.length > 0 ? 'existing' : 'new');
  protected readonly selectedExisting = signal(this.existingSeriesNames[0] ?? '');
  protected readonly newName = signal(this.data.suggestedName);
  protected readonly season = signal(1);
  protected readonly startEpisode = signal(1);
  protected readonly inheritFromExisting = signal(true);

  constructor() {
    if (this.existingSeriesNames.length > 0) {
      this.applySuggestion(this.existingSeriesNames[0]);
    }
  }

  protected onSelectExisting(name: string): void {
    this.selectedExisting.set(name);
    this.applySuggestion(name);
  }

  private applySuggestion(seriesName: string): void {
    const { season, episode } = suggestNextEpisode(this.data.knownItems, seriesName);
    this.season.set(season);
    this.startEpisode.set(episode);
  }

  protected onConfirm(): void {
    const seriesName = this.mode() === 'existing' ? this.selectedExisting() : this.newName().trim();
    if (seriesName.length === 0) {
      return;
    }
    this.dialogRef.close({
      seriesName,
      season: this.season(),
      startEpisode: this.startEpisode(),
      inheritFromExisting: this.mode() === 'existing' && this.inheritFromExisting()
    });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
