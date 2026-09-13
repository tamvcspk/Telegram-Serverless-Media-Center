import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { describeTmdbError, tmdbSearch, toTmdbError } from '../../core/ingest-rpc';
import type { TmdbKind, TmdbSearchResultDto } from '../../core/ingest-rpc.types';

export interface TmdbSearchDialogData {
  initialQuery: string;
  kind: TmdbKind;
}

/** Dialog "smart" (tự gọi `tmdbSearch()`, khác `ConfirmDialog`/`GradeDDialog`
 * thuần hiển thị data truyền vào) — ADR-0019 mục 3/4: query mặc định từ
 * `item.metadata.title`, admin sửa lại được TRƯỚC khi tìm, danh sách kết
 * quả (poster/tên/năm) để admin TỰ CHỌN đúng — không có "tự động chọn kết
 * quả đầu". Đóng dialog trả về kết quả đã chọn, hoặc `undefined` nếu đóng
 * bằng cách khác (cùng nguyên tắc "đóng không phải xác nhận = từ chối" của
 * `ConfirmDialog`). KHÔNG tự mở — luôn qua `DialogService.searchTmdb()`. */
@Component({
  selector: 'app-tmdb-search-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './tmdb-search-dialog.html',
  styleUrl: './tmdb-search-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TmdbSearchDialog implements OnInit {
  protected readonly data = inject<TmdbSearchDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TmdbSearchDialog, TmdbSearchResultDto>>(MatDialogRef);

  protected readonly query = signal(this.data.initialQuery);
  protected readonly results = signal<TmdbSearchResultDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly searched = signal(false);

  ngOnInit(): void {
    // Tự tìm ngay với query mặc định — dialog này chỉ mở sau một cú bấm
    // tường minh ("Tra TMDB"), bắt bấm thêm một lần "Tìm" nữa cho query có
    // sẵn là dư thừa, không phải "gọi API tự động không cần hỏi" (ADR-0019
    // mục 4 nói về việc TỰ ĐỘNG ĐIỀN kết quả, không phải về việc tìm).
    void this.search();
  }

  protected async search(): Promise<void> {
    const q = this.query().trim();
    if (q.length === 0) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const results = await tmdbSearch(q, this.data.kind);
      this.results.set(results);
    } catch (err) {
      this.error.set(describeTmdbError(toTmdbError(err)));
      this.results.set([]);
    } finally {
      this.loading.set(false);
      this.searched.set(true);
    }
  }

  protected onSelect(result: TmdbSearchResultDto): void {
    this.dialogRef.close(result);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
