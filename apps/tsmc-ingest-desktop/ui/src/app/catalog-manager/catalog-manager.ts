import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { buildCatalogEnvelope, mergeCatalogItems, parseExistingCatalogItems } from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { withFloodWaitRetry } from '../core/flood-wait-retry';
import { checkDeletedMessages, deleteMessage, describeIngestError, publishCatalog, readPinnedCatalog, toIngestRpcError } from '../core/ingest-rpc';
import { SelectedChannelStore } from '../core/selected-channel';
import { DialogService } from '../shared/dialog/dialog.service';

/**
 * Trình quản lý catalog (A.4, docs/ux-design.md § Phụ lục A.4 + A.6) — bảng
 * TOÀN BỘ item trong catalog.json đang ghim, sửa/xoá tại chỗ, đối soát với
 * message thật trong kênh, re-publish MỘT LẦN cho cả batch thay đổi (đúng
 * nguyên tắc "catalog luôn là ảnh chụp đầy đủ" đã dùng ở `workspace.ts`).
 *
 * **Phạm vi đối soát (chốt với user, không làm rộng hơn ở slice này):** CHỈ
 * một chiều — phát hiện catalog item trỏ tới message ĐÃ BỊ XOÁ trên kênh
 * (`checkDeletedMessages()`, dùng `get_messages_by_id()` của grammers tra
 * ĐÚNG tập `msgId` catalog đang có, không quét lịch sử kênh — chính xác
 * tuyệt đối, không có vùng "ngoài cửa sổ quét", và tự nhiên bounded theo số
 * item catalog). KHÔNG phát hiện chiều ngược lại (file mồ côi có trong kênh
 * nhưng thiếu trong catalog) — để dành slice sau (cần thêm UI nhập metadata
 * tối thiểu cho item mới phát hiện).
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
 */
@Component({
  selector: 'app-catalog-manager',
  imports: [MatButtonModule, MatMenuModule, MatToolbarModule, MatTooltipModule, ScrollingModule],
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

  protected readonly reconciling = signal(false);
  protected readonly brokenIds = signal<ReadonlySet<number>>(new Set());

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
   * doc comment `removedIds`. */
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
    } catch (err) {
      this.publishError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.publishing.set(false);
    }
  }

  onBack(): void {
    void this.router.navigateByUrl('/workspace');
  }
}
