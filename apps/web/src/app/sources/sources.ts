import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { countMediaBySource, getIndexMeta, getSyncState, liveQuery, type IndexMetaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { SourceRef } from '@tsmc/shared-models';
import { firstValueFrom, from } from 'rxjs';
import { SyncStatus } from '../sync/sync-status';
import { AddSourceSheet, type AddSourceResult } from './add-source-sheet/add-source-sheet';

interface SourceRow {
  source: SourceRef;
  meta: IndexMetaRecord;
  itemCount: number;
}

/**
 * Tab "Nguồn" (Màn hình 4, docs/ux-design.md) — thẻ nguồn thật (tier/item
 * count/lỗi quét gần nhất) + FAB mở `AddSourceSheet` (MatBottomSheet, không
 * phải popup giữa màn hình), gỡ nguồn qua `removeSource()` (xác nhận bằng
 * `confirm()` gốc trình duyệt — cùng quy ước với `onDeleteCollection()` ở
 * `collections/collections.ts`: hành động hiếm, không đáng một dialog riêng).
 * `scanSource()` (libs/core-index/index-engine.ts)
 * là MỘT LƯỢT bounded, không resumable/không báo tiến trình theo số — mockup
 * "Đang nạp 1500/5000 tin nhắn" cần job nền có tiến trình thật (chưa làm ở
 * slice này), nên trong lúc quét chỉ hiển thị `MatProgressBar` indeterminate,
 * không bịa số. Thay thế hoàn toàn `ChannelIndex` (đã xoá) — phần "chẩn đoán
 * 500 tin không lọc" của nó không có chỗ trong 7 màn hình, bỏ theo cùng
 * quyết định "công cụ debug tạm thời" ghi trong file cũ; xem lại ở git log
 * nếu cần điều tra lại bug admin-cache.
 *
 * `SyncStatus` vẫn tạm host ở đây (không đổi từ trước) — thuộc Màn hình 7
 * (Cài đặt), UI debug thô chờ có chỗ đàng hoàng hơn. Nút Đăng xuất đã CHUYỂN
 * sang `settings/settings.ts` (route `/settings`, Màn hình 7 thật) cùng luồng
 * outbox-flush/xoá IndexedDB đầy đủ — không giữ bản tạm ở đây nữa để tránh
 * hai lối đăng xuất với hai mức an toàn dữ liệu khác nhau.
 */
@Component({
  selector: 'app-sources',
  imports: [DatePipe, MatButtonModule, MatProgressBarModule, SyncStatus],
  templateUrl: './sources.html',
  styleUrl: './sources.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Sources {
  private readonly client = createCoreWorkerClient();
  private readonly bottomSheet = inject(MatBottomSheet);

  protected readonly rows = toSignal(
    from(
      liveQuery(async (): Promise<SourceRow[]> => {
        const state = await getSyncState();
        const sources = Object.values(state.sources).filter((s) => !s.removed);
        return Promise.all(
          sources.map(async (source) => ({
            source,
            meta: await getIndexMeta(source.id),
            itemCount: await countMediaBySource(source.id)
          }))
        );
      })
    ),
    { initialValue: [] as SourceRow[] }
  );

  protected readonly addingSource = signal(false);
  protected readonly scanningIds = signal<ReadonlySet<string>>(new Set());
  protected readonly needsFullScanIds = signal<ReadonlySet<string>>(new Set());
  protected readonly removingIds = signal<ReadonlySet<string>>(new Set());
  protected readonly actionError = signal<string | null>(null);

  sourceLabel(source: SourceRef): string {
    const title = source.patch?.['title'];
    return typeof title === 'string' && title.length > 0 ? title : source.ref;
  }

  statusLabel(meta: IndexMetaRecord): string {
    switch (meta.tier) {
      case 'catalog':
        return 'Đã nạp catalog';
      case 'full':
        return 'Đã quét toàn bộ';
      case 'delta':
        return 'Đã quét (một phần)';
      default:
        return 'Chưa quét';
    }
  }

  async onOpenAddSource(): Promise<void> {
    const sheetRef = this.bottomSheet.open(AddSourceSheet);
    const result = await firstValueFrom(sheetRef.afterDismissed());
    if (!result) {
      return;
    }
    await this.addSource(result);
  }

  private async addSource(result: AddSourceResult): Promise<void> {
    this.addingSource.set(true);
    this.actionError.set(null);
    try {
      if (result.kind === 'ref') {
        await this.client.addSource(crypto.randomUUID(), result.ref);
      } else {
        const sourceId = crypto.randomUUID();
        // link t.me/c/<id> tự sinh từ picker CỦA CHÍNH tài khoản này — không
        // phải chia sẻ id thô do người khác đưa (CLAUDE.md bất biến #10).
        await this.client.addSource(sourceId, `https://t.me/c/${result.id}`);
        await this.client.configureSource(sourceId, { title: result.title });
      }
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.addingSource.set(false);
    }
  }

  async onScan(sourceId: string, ref: string, opts?: { tier: 'full' }): Promise<void> {
    this.scanningIds.update((prev) => new Set(prev).add(sourceId));
    this.actionError.set(null);
    try {
      const result = await this.client.scanSource(sourceId, ref, opts);
      this.needsFullScanIds.update((prev) => {
        const next = new Set(prev);
        if (result.needsFullScanConfirmation) {
          next.add(sourceId);
        } else {
          next.delete(sourceId);
        }
        return next;
      });
      if (result.error) {
        this.actionError.set(result.error);
      }
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.scanningIds.update((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  }

  async onRemoveSource(sourceId: string): Promise<void> {
    const label = this.rows().find((row) => row.source.id === sourceId);
    if (!confirm(`Gỡ nguồn "${label ? this.sourceLabel(label.source) : sourceId}"? Phim đã quét từ nguồn này sẽ không còn xuất hiện ở Trang chủ/Bộ sưu tập.`)) {
      return;
    }
    this.removingIds.update((prev) => new Set(prev).add(sourceId));
    this.actionError.set(null);
    try {
      await this.client.removeSource(sourceId);
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.removingIds.update((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  }
}
