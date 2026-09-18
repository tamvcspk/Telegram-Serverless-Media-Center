import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import {
  buildCatalogEnvelope,
  composeCaption,
  flattenMetadataTree,
  mergeCatalogItems,
  parseExistingCatalogItems,
  seasonGroupKey,
  seedMetadataFromFilename,
  seriesGroupKey,
  type FlatMetadataRow
} from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { withFloodWaitRetry } from '../core/flood-wait-retry';
import {
  checkDeletedMessages,
  deleteMessage,
  describeIngestError,
  editMessageCaption,
  publishCatalog,
  readPinnedCatalog,
  scanChannelVideos,
  toIngestRpcError,
  uploadTmdbPoster
} from '../core/ingest-rpc';
import type { TmdbKind } from '../core/ingest-rpc.types';
import { SelectedChannelStore } from '../core/selected-channel';
import type { PosterChange } from '../shared/dialog/advanced-metadata-dialog';
import { DialogService } from '../shared/dialog/dialog.service';
import type { OrphanReviewDialogItem } from '../shared/dialog/orphan-review-dialog';

/** Poster thay đổi CHỜ (từ "Sửa nâng cao") + msgId poster CŨ tại thời điểm mở
 * dialog — cần cả hai để lúc "Lưu catalog" biết CHÍNH XÁC message poster nào
 * cần xoá SAU khi catalog mới publish thành công (không xoá TRƯỚC — nếu
 * publish thất bại giữa chừng, admin không nên mất luôn poster cũ). */
interface PendingPosterChange {
  change: PosterChange;
  previousPosterMsgId?: number;
}

/**
 * Trình quản lý catalog (A.4, docs/ux-design.md § Phụ lục A.4 + A.6) — bảng
 * TOÀN BỘ item trong catalog.json đang ghim, sửa/xoá tại chỗ, đối soát với
 * message thật trong kênh, re-publish MỘT LẦN cho cả batch thay đổi (đúng
 * nguyên tắc "catalog luôn là ảnh chụp đầy đủ" đã dùng ở `workspace.ts`).
 *
 * **Phạm vi đối soát:** HAI chiều, hai nút riêng (chi phí RPC khác nhau, giữ
 * tường minh — không gộp làm một):
 * - Chiều xuôi (`onReconcile()`) — phát hiện catalog item trỏ tới message ĐÃ
 *   BỊ XOÁ trên kênh (`checkDeletedMessages()`, dùng `get_messages_by_id()`
 *   của grammers tra ĐÚNG tập `msgId` catalog đang có, không quét lịch sử
 *   kênh — chính xác tuyệt đối, không có vùng "ngoài cửa sổ quét", và tự
 *   nhiên bounded theo số item catalog).
 * - Chiều ngược lại (`onScanOrphans()`, 2026-09-16) — phát hiện file mồ côi
 *   có trên kênh nhưng thiếu trong catalog (`scanChannelVideos()`, quét
 *   TOÀN BỘ lịch sử kênh bằng `iter_messages()`, không bounded — tốn hơn
 *   hẳn chiều xuôi nên KHÔNG tự chạy chung, chỉ chạy khi user bấm riêng).
 *   Kết quả hiện qua `OrphanReviewDialog` (toggle từng dòng, mặc định chọn
 *   hết); dòng nào được chọn thì seed bằng `seedMetadataFromFilename()`
 *   (`@tsmc/core-ingest`, dùng lại nguyên vẹn) rồi APPEND thẳng vào
 *   `items()` đang sửa — từ đó sửa/xoá/publish qua đúng luồng bảng catalog
 *   sẵn có, không cần UI riêng cho "item mới phát hiện".
 *
 * Dữ liệu đọc từ Telegram (catalog.json do CHÍNH kênh của mình soạn, nhưng
 * vẫn không tin tuyệt đối — CLAUDE.md bất biến #7) qua `parseExistingCatalogItems()`
 * (`@tsmc/core-ingest`, dùng lại NGUYÊN VẸN — không viết lại validate/kẹp độ
 * dài ở tầng UI, item sai schema bị loại âm thầm thay vì hỏng cả bảng).
 *
 * **"Xoá":** hai lựa chọn tách biệt (chốt với user) — "Xoá khỏi catalog"
 * (chỉ gỡ entry khỏi mảng đang sửa, STAGE tới khi bấm "Lưu catalog", KHÔNG
 * đụng gì tới Telegram) và "Xoá khỏi catalog + xoá message trên kênh" (mở
 * `DialogService.confirm()` tone warn — xác nhận xong gọi `deleteMessage()`
 * NGAY LẬP TỨC vì đây là hành động mạng không hoàn tác được, rồi MỚI gỡ khỏi
 * mảng đang sửa cùng cách trên).
 *
 * **Sync hashtag caption (2026-09-18, ADR-0019 § addendum):** `onPublish()`
 * xong catalog thì gọi thêm `syncHashtagCaptions()` — diff `composeCaption()`
 * cũ/mới theo `msgId` (so với `remoteItems` vừa đọc lại NGAY TRƯỚC lúc
 * publish), chỉ `editMessageCaption()` đúng dòng thực sự đổi. Item mới thêm
 * qua "Tìm file mồ côi" bị BỎ QUA có chủ đích — không biết/không kiểm soát
 * caption gốc của message đó, xem doc comment `syncHashtagCaptions()`.
 */
@Component({
  selector: 'app-catalog-manager',
  imports: [MatButtonModule, MatCheckboxModule, MatMenuModule, MatToolbarModule, MatTooltipModule, ScrollingModule],
  templateUrl: './catalog-manager.html',
  styleUrl: './catalog-manager.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogManager implements OnInit {
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  protected readonly selectedChannelStore = inject(SelectedChannelStore);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly pinnedMsgId = signal<number | null>(null);
  protected readonly items = signal<CatalogItemV1[]>([]);
  /** `msgId` user đã bấm "Xoá khỏi catalog" (hoặc "...+ xoá message") trong
   * phiên sửa này — theo dõi RIÊNG khỏi `items()` để `onPublish()` loại
   * đúng những id này ra khỏi catalog MỚI, kể cả khi catalog trên kênh có
   * item MỚI xuất hiện đồng thời (vd upload từ Workspace trong lúc màn này
   * đang mở) — không dùng "item nào KHÔNG còn trong items()" làm tiêu chí
   * loại, vì cách đó sẽ vô tình loại luôn item mới đó (không có trong
   * `items()` chỉ vì màn này nạp TRƯỚC khi nó xuất hiện, không phải vì user
   * chọn xoá). */
  protected readonly removedIds = signal<ReadonlySet<number>>(new Set());
  protected readonly dirty = signal(false);
  protected readonly searchText = signal('');

  /** Checkbox chọn dòng (brainstorm 2026-09-18, cho bulk "Chuyển thành phim
   * lẻ") — cùng cách `removedIds`/`brokenIds` đã làm: theo dõi RIÊNG khỏi
   * `items()`, không phải field trên từng item. */
  protected readonly selectedIds = signal<ReadonlySet<number>>(new Set());
  /** Poster đổi/xoá từ "Sửa nâng cao" — CHƯA upload/xoá message thật, chỉ
   * thực thi lúc "Lưu catalog" (`onPublish()`), TRƯỚC khi build envelope
   * (poster msgId phải có mặt trong catalog vừa publish, khác hashtag
   * caption vốn không nằm trong nội dung catalog.json nên sync được SAU). */
  protected readonly pendingPosterChanges = signal<ReadonlyMap<number, PendingPosterChange>>(new Map());
  /** Nhóm (series/season) đang thu gọn — `seriesGroupKey()`/`seasonGroupKey()`
   * (`@tsmc/core-ingest`). Mặc định TẤT CẢ mở rộng (rỗng) — không ẩn gì bất
   * ngờ lúc mới vào màn. */
  protected readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  protected readonly reconciling = signal(false);
  protected readonly brokenIds = signal<ReadonlySet<number>>(new Set());
  protected readonly scanningOrphans = signal(false);

  protected readonly publishing = signal(false);
  protected readonly publishFloodWaitSeconds = signal<number | null>(null);
  protected readonly publishError = signal<string | null>(null);
  protected readonly publishResult = signal<{ msgId: number; totalItems: number } | null>(null);

  protected readonly filteredItems = computed(() => {
    const q = this.searchText().trim().toLowerCase();
    if (!q) {
      return this.items();
    }
    return this.items().filter((item) => (item.title ?? '').toLowerCase().includes(q) || String(item.msgId).includes(q));
  });

  /** Dạng cây (brainstorm 2026-09-18) — phim lẻ một dòng, phim bộ nhóm
   * `series.name` > `season`. Mảng PHẲNG có discriminant `kind` (không phải
   * cấu trúc lồng nhau) để feed thẳng vào `cdk-virtual-scroll-viewport` đã
   * có sẵn — xem doc comment `flattenMetadataTree()` (`@tsmc/core-ingest`).
   * Tìm kiếm (`filteredItems`) áp dụng TRƯỚC khi nhóm cây, nên gõ tìm sẽ tự
   * thu gọn cây về đúng nhánh khớp (series không có tập nào khớp biến mất
   * hẳn, không hiện dạng rỗng). */
  protected readonly treeRows = computed(() => flattenMetadataTree(this.filteredItems(), (item) => item, this.collapsedGroups()));

  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly allSelected = computed(() => this.items().length > 0 && this.items().every((item) => this.selectedIds().has(item.msgId)));

  ngOnInit(): void {
    if (this.selectedChannelStore.channel() === null) {
      void this.router.navigateByUrl('/channel');
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const pinned = await readPinnedCatalog();
      this.pinnedMsgId.set(pinned?.msg_id ?? null);
      this.items.set(pinned ? parseExistingCatalogItems(pinned.raw) : []);
      this.dirty.set(false);
      this.brokenIds.set(new Set());
      this.removedIds.set(new Set());
      this.selectedIds.set(new Set());
      this.pendingPosterChanges.set(new Map());
    } catch (err) {
      this.loadError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.loading.set(false);
    }
  }

  onSearchInput(value: string): void {
    this.searchText.set(value);
  }

  trackByMsgId(_index: number, item: CatalogItemV1): number {
    return item.msgId;
  }

  /** `trackBy` cho `treeRows()` — header row dùng khoá nhóm (ổn định qua các
   * lần re-render vì chỉ phụ thuộc tên/season, không phụ thuộc thứ tự mảng),
   * leaf row dùng thẳng `msgId`. */
  protected trackByTreeRow(_index: number, row: FlatMetadataRow<CatalogItemV1>): string {
    switch (row.kind) {
      case 'series-header':
        return seriesGroupKey(row.seriesName);
      case 'season-header':
        return seasonGroupKey(row.seriesName, row.season);
      case 'movie':
      case 'episode':
        return `item:${row.row.msgId}`;
    }
  }

  protected toggleSeriesCollapsed(seriesName: string): void {
    this.toggleCollapsed(seriesGroupKey(seriesName));
  }

  protected toggleSeasonCollapsed(seriesName: string, season: number | undefined): void {
    this.toggleCollapsed(seasonGroupKey(seriesName, season));
  }

  private toggleCollapsed(key: string): void {
    this.collapsedGroups.update((keys) => {
      const next = new Set(keys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  onTitleInput(msgId: number, value: string): void {
    this.patchItem(msgId, { title: value.trim().length > 0 ? value.trim() : undefined });
  }

  onYearInput(msgId: number, value: string): void {
    this.patchItem(msgId, { year: value ? Number(value) : undefined });
  }

  onSeasonInput(msgId: number, value: string): void {
    this.patchSeries(msgId, { season: value ? Number(value) : undefined });
  }

  onEpisodeInput(msgId: number, value: string): void {
    this.patchSeries(msgId, { episode: value ? Number(value) : undefined });
  }

  protected toggleSelectAll(checked: boolean): void {
    this.selectedIds.set(checked ? new Set(this.items().map((item) => item.msgId)) : new Set());
  }

  protected toggleSelected(msgId: number, checked: boolean): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (checked) {
        next.add(msgId);
      } else {
        next.delete(msgId);
      }
      return next;
    });
  }

  /** "Sửa nâng cao" (brainstorm 2026-09-18) — dialog dùng chung với
   * `workspace.ts` (`AdvancedMetadataDialog`). Poster đổi/xoá KHÔNG thực thi
   * ngay — ghi vào `pendingPosterChanges`, xử lý lúc "Lưu catalog" (đúng thứ
   * tự bắt buộc: upload/xoá poster PHẢI xong TRƯỚC khi build envelope, vì
   * `poster.msgId` là một field NẰM TRONG catalog.json, khác hashtag caption
   * vốn không thuộc nội dung catalog nên sync được sau khi publish xong). */
  protected async onEditAdvanced(item: CatalogItemV1): Promise<void> {
    const kind: TmdbKind = item.kind === 'episode' ? 'episode' : 'movie';
    const result = await this.dialogService.editAdvancedMetadata(item, kind, item.poster?.msgId);
    if (!result) {
      return;
    }
    this.patchItem(item.msgId, result.item);
    if (result.posterChange) {
      this.pendingPosterChanges.update((m) => new Map(m).set(item.msgId, { change: result.posterChange!, previousPosterMsgId: item.poster?.msgId }));
    }
  }

  /** "Chuyển thành phim lẻ" hàng loạt — vá 2026-09-18: bỏ điều kiện "phải
   * xoá Ep TRƯỚC" (bug thật, xem doc comment `workspace.ts::convertSelectedToMovie()`).
   * Chuyển THẲNG mọi dòng đã chọn có `kind === 'episode'`, xoá `series`
   * luôn — chỉ đổi buffer đang sửa, chưa ghi Telegram tới khi "Lưu catalog". */
  protected convertSelectedToMovie(): void {
    const ids = this.selectedIds();
    for (const item of this.items()) {
      if (ids.has(item.msgId) && item.kind === 'episode') {
        this.patchItem(item.msgId, { kind: 'movie', series: undefined });
      }
    }
  }

  private patchItem(msgId: number, patch: Partial<CatalogItemV1>): void {
    this.items.update((items) => items.map((item) => (item.msgId === msgId ? { ...item, ...patch } : item)));
    this.dirty.set(true);
  }

  private patchSeries(msgId: number, patch: Partial<NonNullable<CatalogItemV1['series']>>): void {
    this.items.update((items) =>
      items.map((item) => (item.msgId === msgId ? { ...item, series: { name: item.series?.name ?? '', ...item.series, ...patch } } : item))
    );
    this.dirty.set(true);
  }

  /** Đối soát thủ công (nút toolbar) — không tự chạy lúc mount, giữ chi phí
   * RPC tường minh (đúng nguyên tắc "Tra TMDB" cũng là nút thủ công, không
   * tự gọi lúc mở màn). */
  async onReconcile(): Promise<void> {
    const msgIds = this.items().map((item) => item.msgId);
    if (msgIds.length === 0) {
      return;
    }
    this.reconciling.set(true);
    try {
      const missing = await checkDeletedMessages(msgIds);
      this.brokenIds.set(new Set(missing));
    } catch (err) {
      this.loadError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.reconciling.set(false);
    }
  }

  /** Đối soát chiều ngược lại (nút toolbar riêng, thủ công — cùng lý do
   * "chi phí RPC tường minh" ở `onReconcile()`, nhưng tốn hơn hẳn vì phải
   * quét TOÀN BỘ lịch sử kênh). Rỗng → báo bằng `alert()`, không mở dialog
   * vô ích. Không rỗng → `OrphanReviewDialog`, dòng nào được chọn thì seed
   * metadata từ tên file rồi APPEND vào `items()` đang sửa (chỉ có hiệu lực
   * thật sau khi bấm "Lưu catalog", giống mọi sửa đổi khác ở màn này). */
  async onScanOrphans(): Promise<void> {
    this.scanningOrphans.set(true);
    try {
      const docs = await scanChannelVideos();
      const catalogIds = new Set(this.items().map((item) => item.msgId));
      const orphans = docs.filter((d) => !catalogIds.has(d.msg_id));

      if (orphans.length === 0) {
        await this.dialogService.alert({
          title: 'Đối soát chiều ngược lại',
          message: 'Không tìm thấy file mồ côi nào — mọi video trên kênh đều đã có trong catalog.'
        });
        return;
      }

      const dialogItems: OrphanReviewDialogItem[] = orphans.map((d) => ({
        msgId: d.msg_id,
        fileName: d.file_name ?? `#${d.msg_id}`,
        sizeLabel: `${(d.size / 1_000_000).toFixed(1)} MB`,
        durationLabel: d.duration_sec ? formatDuration(d.duration_sec) : null
      }));
      const selected = await this.dialogService.reviewOrphans(dialogItems);
      if (selected.size === 0) {
        return;
      }

      const toAdd = orphans.filter((d) => selected.has(d.msg_id)).map((d) => seedMetadataFromFilename(d.msg_id, d.file_name ?? `#${d.msg_id}`));
      this.items.update((items) => [...items, ...toAdd]);
      this.dirty.set(true);
    } catch (err) {
      this.loadError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.scanningOrphans.set(false);
    }
  }

  /** Chỉ gỡ khỏi mảng đang sửa — KHÔNG đụng Telegram. Cần "Lưu catalog" để
   * thật sự có hiệu lực trên kênh. */
  removeFromCatalog(msgId: number): void {
    this.items.update((items) => items.filter((item) => item.msgId !== msgId));
    this.removedIds.update((ids) => new Set(ids).add(msgId));
    this.brokenIds.update((ids) => {
      if (!ids.has(msgId)) {
        return ids;
      }
      const next = new Set(ids);
      next.delete(msgId);
      return next;
    });
    this.selectedIds.update((ids) => {
      if (!ids.has(msgId)) {
        return ids;
      }
      const next = new Set(ids);
      next.delete(msgId);
      return next;
    });
    this.pendingPosterChanges.update((m) => {
      if (!m.has(msgId)) {
        return m;
      }
      const next = new Map(m);
      next.delete(msgId);
      return next;
    });
    this.dirty.set(true);
  }

  /** Xoá HẲN message trên kênh — hành động mạng không hoàn tác được, chạy
   * NGAY lúc xác nhận (khác `removeFromCatalog()`, vốn chỉ staging tới lúc
   * Lưu). Gỡ khỏi mảng đang sửa SAU KHI xoá message thành công. */
  async removeFromCatalogAndChannel(item: CatalogItemV1): Promise<void> {
    const label = item.title ?? `#${item.msgId}`;
    const confirmed = await this.dialogService.confirm({
      title: 'Xoá message trên kênh?',
      message: `"${label}" sẽ bị xoá HẲN khỏi kênh Telegram (không hoàn tác được), cộng gỡ khỏi catalog. Chỉ hiệu lực trên catalog sau khi bấm "Lưu catalog".`,
      confirmText: 'Xoá trên kênh',
      cancelText: 'Huỷ',
      tone: 'warn'
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteMessage(item.msgId);
    } catch (err) {
      this.loadError.set(describeIngestError(toIngestRpcError(err)));
      return;
    }
    this.removeFromCatalog(item.msgId);
  }

  /** Đọc lại catalog đang ghim NGAY LÚC publish (không dùng bản đã đọc lúc
   * mount — có thể đã cũ, vd item mới upload từ Workspace trong lúc màn này
   * đang mở). Loại `removedIds()` ra khỏi bản MỚI NHẤT đó trước, rồi mới gộp
   * với `items()` đang sửa (`mergeCatalogItems` ưu tiên bản trong `items()`
   * — cùng `msgId` thì item sau thắng, đúng ngữ nghĩa "đây là bản đã sửa").
   * KHÔNG dùng "item nào không còn trong items()" làm tiêu chí loại — xem
   * doc comment `removedIds`.
   *
   * **Thứ tự bắt buộc (ADR-0019 § addendum "Advanced Metadata Edit"):**
   * resolve poster (upload/xoá) TRƯỚC khi build envelope — `poster.msgId`
   * là field NẰM TRONG `catalog.json`, khác hashtag caption (không thuộc
   * nội dung catalog nên sync được SAU khi publish xong, xem
   * `syncHashtagCaptions()`). Nếu resolve poster lỗi, ABORT toàn bộ publish
   * (không gọi `publishCatalog()`) — khác hashtag caption vốn best-effort,
   * vì đây là nội dung catalog thật, không nên publish nửa vời. */
  async onPublish(): Promise<void> {
    const channel = this.selectedChannelStore.channel();
    if (!channel) {
      void this.router.navigateByUrl('/channel');
      return;
    }
    this.publishing.set(true);
    this.publishError.set(null);
    this.publishResult.set(null);
    try {
      const oldPosterMsgIdsToDelete = await this.resolvePendingPosters();

      const pinned = await readPinnedCatalog();
      const remoteItems = pinned ? parseExistingCatalogItems(pinned.raw) : [];
      const removed = this.removedIds();
      const remoteMinusRemoved = remoteItems.filter((item) => !removed.has(item.msgId));
      const merged = mergeCatalogItems(remoteMinusRemoved, this.items());
      const envelope = buildCatalogEnvelope({ id: channel.id, title: channel.title }, merged);

      const result = await withFloodWaitRetry(
        (s) => this.publishFloodWaitSeconds.set(s),
        () => publishCatalog(JSON.stringify(envelope), pinned?.msg_id ?? null)
      );

      this.pinnedMsgId.set(result.msg_id);
      this.selectedChannelStore.set(channel, `${merged.length} item`);
      this.publishResult.set({ msgId: result.msg_id, totalItems: merged.length });
      this.dirty.set(false);
      this.pendingPosterChanges.set(new Map());

      // Xoá message poster CŨ chỉ SAU KHI catalog mới đã publish thành công
      // — publish thất bại giữa chừng không nên khiến admin mất luôn poster
      // cũ trong lúc catalog vẫn còn trỏ tới nó. Best-effort, không chặn kết
      // quả publish đã thành công.
      for (const msgId of oldPosterMsgIdsToDelete) {
        try {
          await withFloodWaitRetry(
            (s) => this.publishFloodWaitSeconds.set(s),
            () => deleteMessage(msgId)
          );
        } catch {
          // Poster cũ mồ côi lại trên kênh — vô hại (không còn catalog nào
          // trỏ tới), không đáng chặn/báo lỗi cho một hành động dọn dẹp phụ.
        }
      }

      await this.syncHashtagCaptions(remoteItems);
    } catch (err) {
      this.publishError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.publishing.set(false);
    }
  }

  /** Upload poster mới / xoá field `poster` cho mọi item có trong
   * `pendingPosterChanges()`, ghi thẳng vào `this.items()` TRƯỚC khi
   * `onPublish()` build envelope. Trả về danh sách `msgId` poster CŨ cần
   * xoá trên kênh SAU khi publish thành công (không xoá ở đây — xem doc
   * comment `onPublish()`). Ném lỗi thẳng ra ngoài nếu một upload thất bại —
   * `onPublish()` bắt lỗi này và KHÔNG publish gì cả (an toàn hơn publish
   * catalog thiếu poster của đúng item admin vừa sửa). */
  private async resolvePendingPosters(): Promise<number[]> {
    const pending = this.pendingPosterChanges();
    if (pending.size === 0) {
      return [];
    }
    const oldMsgIdsToDelete: number[] = [];
    for (const [msgId, { change, previousPosterMsgId }] of pending) {
      if (change.type === 'remove') {
        this.patchItem(msgId, { poster: undefined });
      } else {
        const item = this.items().find((i) => i.msgId === msgId);
        const fileName = `${(item?.title ?? `poster-${msgId}`).replace(/[^\p{L}\p{N}]+/gu, '_')}.poster.jpg`;
        const uploaded = await withFloodWaitRetry(
          (s) => this.publishFloodWaitSeconds.set(s),
          () => uploadTmdbPoster(change.posterPath, fileName)
        );
        this.patchItem(msgId, { poster: { msgId: uploaded.msg_id } });
      }
      if (previousPosterMsgId !== undefined) {
        oldMsgIdsToDelete.push(previousPosterMsgId);
      }
    }
    return oldMsgIdsToDelete;
  }

  /** Sync hashtag caption (ADR-0019 § addendum 2026-09-18) — SAU khi catalog
   * đã publish thành công. Diff `composeCaption()` cũ (`remoteItems`, vừa
   * đọc lại ngay trước publish — không dùng bản nạp lúc mount, có thể đã cũ)
   * với bản đang sửa, chỉ `editMessageCaption()` đúng những `msgId` thực sự
   * đổi — KHÔNG phải quét lại/sửa cả catalog mỗi lần Lưu. Cố ý bỏ qua item
   * KHÔNG có trong `remoteItems` (mới thêm qua "Tìm file mồ côi" hoặc mới
   * upload từ Workspace) — không biết/không kiểm soát caption gốc của
   * message đó, ghi đè mù có thể xoá mất nội dung caption thật admin đã viết
   * tay trước khi có app. Best-effort: một caption lỗi KHÔNG làm hỏng catalog
   * vừa publish thành công (đã lưu xong), chỉ báo riêng cho admin biết. */
  private async syncHashtagCaptions(remoteItems: CatalogItemV1[]): Promise<void> {
    const remoteByMsgId = new Map(remoteItems.map((item) => [item.msgId, item]));
    const changed = this.items().filter((item) => {
      const remote = remoteByMsgId.get(item.msgId);
      return remote !== undefined && composeCaption(remote) !== composeCaption(item);
    });
    if (changed.length === 0) {
      return;
    }

    const failures: string[] = [];
    for (const item of changed) {
      try {
        await withFloodWaitRetry(
          (s) => this.publishFloodWaitSeconds.set(s),
          () => editMessageCaption(item.msgId, composeCaption(item))
        );
      } catch (err) {
        failures.push(`#${item.msgId}: ${describeIngestError(toIngestRpcError(err))}`);
      }
    }
    if (failures.length > 0) {
      await this.dialogService.alert({
        title: 'Đồng bộ hashtag caption',
        message: `Catalog đã lưu, nhưng ${failures.length} caption chưa đồng bộ được:\n${failures.join('\n')}`
      });
    }
  }

  onBack(): void {
    void this.router.navigateByUrl('/workspace');
  }
}

/** `mm:ss` cho hiển thị trong `OrphanReviewDialog` — không có helper dùng
 * chung sẵn trong app này (`ingest-rpc.ts` cũng chỉ format inline tại chỗ
 * dùng), không bịa thêm abstraction cho một chỗ dùng duy nhất. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
