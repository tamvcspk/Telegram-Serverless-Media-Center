import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { TmdbKind, TmdbSearchResultDto } from '../../core/ingest-rpc.types';
import { ConfirmDialog, type ConfirmDialogData } from './confirm-dialog';
import { GradeDDialog, type GradeDDialogItem } from './grade-d-dialog';
import { OrphanReviewDialog, type OrphanReviewDialogItem } from './orphan-review-dialog';
import { TmdbKeyDialog, type TmdbKeyDialogData } from './tmdb-key-dialog';
import { TmdbSearchDialog, type TmdbSearchDialogData } from './tmdb-search-dialog';

/** Trang TMDB nơi tự đăng ký lấy API Key miễn phí — hardcode ở đây (không
 * phải trong component dialog) để chỉ một chỗ cần sửa nếu TMDB đổi URL. */
const TMDB_API_KEY_HELP_URL = 'https://www.themoviedb.org/settings/api';

export type AlertOptions = Omit<ConfirmDialogData, 'mode' | 'cancelText'>;
export type ConfirmOptions = Omit<ConfirmDialogData, 'mode'>;

/**
 * Cổng DUY NHẤT mở `ConfirmDialog` — component đó không tự mở, mọi nơi cần
 * hỏi/báo trong app gọi qua service này thay vì `window.confirm()`/
 * `window.alert()` (dialog gốc trình duyệt, không theo theme Material, và
 * KHÔNG kiểm soát được nút màu warn — cần cho cảnh báo Hạng D re-encode,
 * mockup A.2 mục 1).
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(MatDialog);

  /** Chỉ có nút xác nhận — dùng để BÁO, không hỏi (vd lỗi nghiêm trọng cần
   * người dùng đọc rồi tự bấm qua, không có lựa chọn "huỷ" nào hợp lý). */
  async alert(options: AlertOptions): Promise<void> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: { ...options, mode: 'alert' },
      width: '26rem'
    });
    await firstValueFrom(ref.afterClosed());
  }

  /** Có cả hai nút — trả `true` nếu người dùng bấm xác nhận, `false` nếu
   * Huỷ HOẶC đóng dialog bằng cách khác (bấm ra ngoài, phím Esc) — mọi
   * đường đóng không phải "xác nhận" đều coi là từ chối, không có trạng thái
   * thứ ba nào để caller phải xử lý. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: { ...options, mode: 'confirm' },
      width: '26rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result === true;
  }

  /** Xác nhận re-encode Hạng D cho CẢ BATCH trong một dialog, toggle riêng
   * từng file (ADR-0018 § "Quyết định kèm theo") — thay hỏi từng file một
   * dialog riêng. Trả về tập `path` các file VẪN được chọn chạy; đóng dialog
   * bằng cách khác (Esc/bấm ra ngoài) → tập RỖNG (không file nào chạy, cùng
   * nguyên tắc "đóng không phải xác nhận = từ chối" của `confirm()`). */
  async confirmGradeD(items: GradeDDialogItem[]): Promise<ReadonlySet<string>> {
    const ref = this.dialog.open<GradeDDialog, { items: GradeDDialogItem[] }, string[]>(GradeDDialog, {
      data: { items },
      width: '30rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return new Set(result ?? []);
  }

  /** Hiện danh sách file mồ côi tìm thấy khi quét TOÀN BỘ lịch sử kênh (đối
   * soát chiều ngược lại, Trình quản lý catalog, 2026-09-16) — toggle riêng
   * từng dòng, mặc định TẤT CẢ được chọn. Trả về tập `msgId` còn được chọn;
   * đóng bằng nút "Đóng"/Esc/bấm ra ngoài → tập RỖNG (không thêm gì, cùng
   * nguyên tắc "đóng không phải xác nhận = từ chối" của `confirm()`). */
  async reviewOrphans(items: OrphanReviewDialogItem[]): Promise<ReadonlySet<number>> {
    const ref = this.dialog.open<OrphanReviewDialog, { items: OrphanReviewDialogItem[] }, number[]>(OrphanReviewDialog, {
      data: { items },
      width: '32rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return new Set(result ?? []);
  }

  /** Hiện dialog nhập TMDB API Key (ADR-0019 mục 2) — gọi khi
   * `tmdbHasKey()` trả `false`. Trả về key đã nhập (chưa lưu — caller tự
   * gọi `tmdbSaveKey()`), hoặc `null` nếu admin huỷ. */
  async promptTmdbApiKey(): Promise<string | null> {
    const ref = this.dialog.open<TmdbKeyDialog, TmdbKeyDialogData, string>(TmdbKeyDialog, {
      data: { helpUrl: TMDB_API_KEY_HELP_URL },
      width: '26rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result ?? null;
  }

  /** Hiện dialog tìm TMDB (ADR-0019 mục 3/4) — `initialQuery` thường là
   * `item.metadata.title` đã seed sẵn từ filename, admin sửa lại được trong
   * dialog. Trả về kết quả admin CHỌN, hoặc `null` nếu đóng mà không chọn
   * gì (cùng nguyên tắc "đóng không phải xác nhận = từ chối"). */
  async searchTmdb(initialQuery: string, kind: TmdbKind): Promise<TmdbSearchResultDto | null> {
    const ref = this.dialog.open<TmdbSearchDialog, TmdbSearchDialogData, TmdbSearchResultDto>(TmdbSearchDialog, {
      data: { initialQuery, kind },
      width: '28rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result ?? null;
  }
}
