import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule, type MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { describeTmdbError, downloadDocument, tmdbDetails, tmdbGenreList, toPosterDataUri, toTmdbError } from '../../core/ingest-rpc';
import type { TmdbKind, TmdbSearchResultDto } from '../../core/ingest-rpc.types';

export type PosterChange = { type: 'replace'; posterPath: string; posterUrl: string | null } | { type: 'remove' };

export interface AdvancedMetadataResult {
  item: CatalogItemV1;
  posterChange?: PosterChange;
}

export interface AdvancedMetadataDialogData {
  item: CatalogItemV1;
  /** `'episode'` → `search/tv`/`/tv/{id}` (created_by), `'movie'` →
   * `search/movie`/`/movie/{id}` (crew Director) — cùng suy luận
   * `item.metadata.kind` mà `onTmdbLookup()` (`workspace.ts`) đã dùng. */
  kind: TmdbKind;
  /** Poster ĐÃ upload từ một lần trước (nếu có) — dialog tự tải ảnh xem
   * trước qua `downloadDocument()`. `undefined` nếu item chưa từng có poster. */
  posterMsgId?: number;
  /** Callback mở `TmdbSearchDialog` — truyền từ tầng gọi (đã có
   * `DialogService`) thay vì dialog này tự `inject(DialogService)`, để né
   * import vòng (`DialogService` phải import CHÍNH dialog này để mở nó). */
  searchTmdb: (initialQuery: string, kind: TmdbKind) => Promise<TmdbSearchResultDto | null>;
}

/**
 * "Sửa nâng cao" (brainstorm 2026-09-18, ADR-0019 § addendum "Advanced
 * Metadata Edit") — MỘT dialog dùng chung cho cả `workspace.ts` (Draft,
 * trước upload) lẫn `catalog-manager.ts` (đã publish), tránh viết hai lần
 * hai nơi (đúng bài học rút ra từ quyết định "Ingest Editor web vs
 * ingest-desktop" — mọi field mới sau này chỉ sửa MỘT chỗ).
 *
 * Field ở đây là phần KHÔNG có trong Quick edit của bảng (Title/Năm/
 * Season/Ep vẫn sửa trực tiếp ở ô bảng, không lặp lại trong dialog này):
 * `series.name`, `genres`, `cast`, `director`, `poster`, cộng nút "Chuyển
 * thành phim lẻ".
 *
 * **"Chuyển thành phim lẻ"** luôn bật khi item đang là `kind: 'episode'` —
 * KHÔNG còn đòi xoá Ep ở Quick edit trước (bản đầu 2026-09-18 gate theo
 * `series?.episode === undefined`, nhưng đó là bug thật: hầu hết trường
 * hợp cần chuyển ĐANG có Ep — đúng lý do cần chuyển — nên gate đó khiến nút
 * "không hoạt động, không biểu hiện gì" ở đúng trường hợp thường gặp nhất).
 * Bấm là ĐÁNH DẤU ý định (`convertedToMovie` signal), chỉ thật sự áp dụng
 * (xoá `series`) khi bấm "Lưu" — "Lưu"/"Huỷ" của chính dialog này ĐÃ là
 * bước xác nhận, không cần thêm cổng nào khác. Một chiều duy nhất (episode
 * → movie) — chiều ngược lại (movie → episode) đã có sẵn tự nhiên khi admin
 * gõ Season/Ep ở Quick edit (`onSeasonInput`/`onEpisodeInput` tự set
 * `kind: 'episode'`).
 *
 * **Poster:** xem trước ảnh ĐÃ có (nếu `posterMsgId` — tải qua
 * `downloadDocument()`), đổi bằng "Tra TMDB" (tái dùng `TmdbSearchDialog`),
 * hoặc "Xoá poster". KHÔNG upload/xoá message thật ở đây — trả
 * `posterChange` cho tầng gọi tự xử lý lúc publish/lưu (đúng pattern
 * `pendingPosterPath` đã có ở Workspace, tránh message poster mồ côi nếu
 * đóng dialog rồi đổi ý).
 *
 * **"Tra TMDB" trong dialog này** tự điền `title`/`year`/`genres`/`cast`/
 * `director`/poster khi admin CHỌN một kết quả — không phải nguồn nhập duy
 * nhất, admin vẫn sửa tay được sau đó trước khi bấm "Lưu" (đóng dialog
 * KHÔNG bấm Lưu = huỷ toàn bộ thay đổi trong phiên mở dialog này, cùng
 * nguyên tắc "đóng không phải xác nhận = từ chối" của `ConfirmDialog`).
 */
@Component({
  selector: 'app-advanced-metadata-dialog',
  imports: [MatButtonModule, MatChipsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './advanced-metadata-dialog.html',
  styleUrl: './advanced-metadata-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdvancedMetadataDialog implements OnInit {
  protected readonly data = inject<AdvancedMetadataDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<AdvancedMetadataDialog, AdvancedMetadataResult>>(MatDialogRef);

  protected readonly title = signal(this.data.item.title ?? '');
  protected readonly year = signal(this.data.item.year);
  protected readonly seriesName = signal(this.data.item.series?.name ?? '');
  protected readonly genres = signal<string[]>(this.data.item.genres ?? []);
  protected readonly cast = signal<string[]>(this.data.item.cast ?? []);
  protected readonly director = signal(this.data.item.director ?? '');

  protected readonly convertedToMovie = signal(false);

  protected readonly genreOptions = signal<string[]>([]);
  protected readonly genreOptionsError = signal<string | null>(null);

  protected readonly posterLoading = signal(this.data.posterMsgId !== undefined);
  protected readonly posterPreviewUrl = signal<string | null>(null);
  protected readonly posterError = signal<string | null>(null);
  protected readonly pendingPoster = signal<{ path: string; url: string | null } | null>(null);
  protected readonly removePoster = signal(false);

  protected readonly tmdbSearching = signal(false);
  protected readonly tmdbError = signal<string | null>(null);

  ngOnInit(): void {
    void this.loadGenreOptions();
    if (this.data.posterMsgId !== undefined) {
      void this.loadPosterPreview(this.data.posterMsgId);
    }
  }

  private async loadGenreOptions(): Promise<void> {
    try {
      this.genreOptions.set(await tmdbGenreList(this.data.kind));
    } catch (err) {
      // Best-effort — picker chỉ là tiện nghi, nhập tay vẫn dùng được nếu
      // chưa có key/mất mạng. Không chặn dialog, chỉ ghi lại lý do.
      this.genreOptionsError.set(describeTmdbError(toTmdbError(err)));
    }
  }

  private async loadPosterPreview(msgId: number): Promise<void> {
    try {
      const base64 = await downloadDocument(msgId);
      this.posterPreviewUrl.set(toPosterDataUri(base64));
    } catch (err) {
      this.posterError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.posterLoading.set(false);
    }
  }

  protected addGenre(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value.length > 0 && !this.genres().includes(value)) {
      this.genres.update((g) => [...g, value]);
    }
    event.chipInput.clear();
  }

  protected addGenreFromOption(name: string): void {
    if (!this.genres().includes(name)) {
      this.genres.update((g) => [...g, name]);
    }
  }

  protected removeGenre(name: string): void {
    this.genres.update((g) => g.filter((x) => x !== name));
  }

  protected addCast(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value.length > 0 && !this.cast().includes(value)) {
      this.cast.update((c) => [...c, value]);
    }
    event.chipInput.clear();
  }

  protected removeCast(name: string): void {
    this.cast.update((c) => c.filter((x) => x !== name));
  }

  protected convertToMovie(): void {
    this.convertedToMovie.set(true);
    this.seriesName.set('');
  }

  /** Tìm + chọn kết quả TMDB, áp dụng title/năm/genres/cast/director/poster
   * ngay vào state cục bộ của dialog (chưa ghi gì ra ngoài tới khi bấm
   * "Lưu") — cùng luồng `onTmdbLookup()` (`workspace.ts`) nhưng gộp cả
   * poster vào một bước, vì đây là nơi DUY NHẤT `catalog-manager.ts` có để
   * tra TMDB (màn đó không có nút "Tra TMDB" rời như Workspace). */
  protected async onSearchTmdb(): Promise<void> {
    this.tmdbError.set(null);
    const query = this.title() || this.seriesName() || this.data.item.title || '';
    const picked = await this.data.searchTmdb(query, this.data.kind);
    if (!picked) {
      return;
    }
    this.title.set(picked.title);
    if (picked.year !== null) {
      this.year.set(picked.year);
    }
    if (picked.poster_path) {
      this.pendingPoster.set({ path: picked.poster_path, url: picked.poster_url });
      this.removePoster.set(false);
    }

    this.tmdbSearching.set(true);
    try {
      const details = await tmdbDetails(picked.id, this.data.kind);
      if (details.genres.length > 0) {
        this.genres.set(details.genres);
      }
      if (details.cast.length > 0) {
        this.cast.set(details.cast);
      }
      if (details.director) {
        this.director.set(details.director);
      }
    } catch (err) {
      this.tmdbError.set(describeTmdbError(toTmdbError(err)));
    } finally {
      this.tmdbSearching.set(false);
    }
  }

  protected onRemovePoster(): void {
    this.removePoster.set(true);
    this.pendingPoster.set(null);
    this.posterPreviewUrl.set(null);
  }

  protected onSave(): void {
    const item: CatalogItemV1 = {
      ...this.data.item,
      title: this.title().trim().length > 0 ? this.title().trim() : undefined,
      year: this.year(),
      kind: this.convertedToMovie() ? 'movie' : this.data.item.kind,
      series: this.convertedToMovie() ? undefined : this.data.item.series ? { ...this.data.item.series, name: this.seriesName() } : undefined,
      genres: this.genres().length > 0 ? this.genres() : undefined,
      cast: this.cast().length > 0 ? this.cast() : undefined,
      director: this.director().trim().length > 0 ? this.director().trim() : undefined
    };

    const pending = this.pendingPoster();
    const posterChange: PosterChange | undefined = pending
      ? { type: 'replace', posterPath: pending.path, posterUrl: pending.url }
      : this.removePoster()
        ? { type: 'remove' }
        : undefined;

    this.dialogRef.close({ item, posterChange });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
