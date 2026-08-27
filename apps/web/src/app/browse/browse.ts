import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { getMediaItem, getSyncState, liveQuery, listAllMedia, type MediaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { Collection, SourceRef } from '@tsmc/shared-models';
import { from, switchMap } from 'rxjs';
import { BrowseStore, type BrowseSort } from './browse.store';

interface BrowseParams {
  sourceId: string | null;
  query: string;
  sort: BrowseSort;
}

async function activeSourceIds(): Promise<Set<string>> {
  const state = await getSyncState();
  return new Set(Object.values(state.sources).filter((s) => !s.removed).map((s) => s.id));
}

function sortRows(rows: MediaRecord[], sort: BrowseSort): MediaRecord[] {
  return [...rows].sort((a, b) =>
    sort === 'year' ? (b.year ?? 0) - (a.year ?? 0) : (a.title ?? '').localeCompare(b.title ?? '', 'vi')
  );
}

/**
 * Duyệt phim (F3.1) + lọc theo nguồn (F3.2) + tìm kiếm MiniSearch (F3.3,
 * ADR-0008). Không gõ tìm kiếm → đọc thẳng IndexedDB qua `liveQuery` (đường
 * đọc, ADR-0007), có gõ → RPC `searchMedia()` chạy trong Core Worker rồi
 * bulk-resolve item thật từ Dexie theo đúng thứ tự relevance trả về.
 *
 * Click vào một item gọi `resolveItemTrust()` — đây chính là "cơ chế truy
 * cập thật" mà khối TẠM THỜI trong channel-index.ts chờ đợi để bị xoá
 * (resolveItemTrust() tự no-op rẻ nếu trust đã resolve từ trước, xem
 * core-index/index-engine.ts).
 */
@Component({
  selector: 'app-browse',
  imports: [ScrollingModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatMenuModule],
  providers: [BrowseStore],
  templateUrl: './browse.html',
  styleUrl: './browse.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Browse {
  private readonly client = createCoreWorkerClient();
  private readonly router = inject(Router);
  protected readonly store = inject(BrowseStore);

  protected readonly sources = toSignal(
    from(liveQuery(async (): Promise<SourceRef[]> => Object.values((await getSyncState()).sources).filter((s) => !s.removed))),
    { initialValue: [] as SourceRef[] }
  );

  // Menu "Thêm vào bộ sưu tập" (entry point duy nhất hiện có để đưa phim vào
  // Collections, Màn hình 3 — không có nó thì BST mới xây sẽ luôn trống).
  // Dùng CHUNG một <mat-menu> cho mọi row thay vì một menu/row — virtual
  // scroll chỉ render ~10-15 row cùng lúc nên chi phí không lớn, nhưng dùng
  // chung vẫn đơn giản hơn: menuTargetRow giữ row nào vừa mở menu.
  protected readonly menuTargetRow = signal<MediaRecord | null>(null);
  protected readonly collections = toSignal(
    from(liveQuery(async (): Promise<Collection[]> => Object.values((await getSyncState()).collections).filter((c) => !c.deleted))),
    { initialValue: [] as Collection[] }
  );

  private readonly params = computed<BrowseParams>(() => ({
    sourceId: this.store.sourceId(),
    query: this.store.query(),
    sort: this.store.sort()
  }));

  protected readonly rows = toSignal(
    toObservable(this.params).pipe(switchMap((params) => from(liveQuery(() => this.loadRows(params))))),
    { initialValue: [] as MediaRecord[] }
  );

  private async loadRows(params: BrowseParams): Promise<MediaRecord[]> {
    const active = await activeSourceIds();
    const query = params.query.trim();

    if (!query) {
      const all = await listAllMedia();
      const filtered = all.filter((item) => active.has(item.sourceId) && (!params.sourceId || item.sourceId === params.sourceId));
      return sortRows(filtered, params.sort);
    }

    const hits = await this.client.searchMedia(query, { sourceId: params.sourceId ?? undefined });
    const resolved = await Promise.all(hits.filter((h) => active.has(h.sourceId)).map((h) => getMediaItem(h.sourceId, h.msgId)));
    // Giữ nguyên thứ tự relevance MiniSearch trả về — Promise.all bảo toàn
    // thứ tự mảng đầu vào, không được sort lại (khác nhánh browse ở trên).
    return resolved.filter((item): item is MediaRecord => item !== undefined);
  }

  trackByRow(_index: number, row: MediaRecord): string {
    return `${row.sourceId}:${row.msgId}`;
  }

  sourceLabel(source: SourceRef): string {
    const title = source.patch?.['title'];
    return typeof title === 'string' && title.length > 0 ? title : source.ref;
  }

  onSourceChipChange(sourceId: string | null): void {
    this.store.setSourceId(sourceId === this.store.sourceId() ? null : sourceId);
  }

  onQueryInput(value: string): void {
    this.store.setQuery(value);
  }

  // "src:<sourceId>/msg:<msgId>" — cùng quy ước khoá ProgressEntry.k (ADR-0009,
  // xem player.ts progressKey) và collections.ts parseItemKey().
  itemKeyOf(row: MediaRecord): string {
    return `src:${row.sourceId}/msg:${row.msgId}`;
  }

  isInCollection(collection: Collection, row: MediaRecord): boolean {
    return collection.items.includes(this.itemKeyOf(row));
  }

  isTargetInCollection(collection: Collection): boolean {
    const row = this.menuTargetRow();
    return row !== null && this.isInCollection(collection, row);
  }

  onOpenCollectionMenu(row: MediaRecord): void {
    this.menuTargetRow.set(row);
  }

  async onToggleCollection(collection: Collection): Promise<void> {
    const row = this.menuTargetRow();
    if (!row) {
      return;
    }
    const key = this.itemKeyOf(row);
    if (collection.items.includes(key)) {
      await this.client.removeFromCollection(collection.id, key);
    } else {
      await this.client.addToCollection(collection.id, key);
    }
  }

  async onItemClick(row: MediaRecord): Promise<void> {
    const source = this.sources().find((s) => s.id === row.sourceId);
    if (!source) {
      return;
    }
    await this.client.resolveItemTrust(row.sourceId, source.ref, row.msgId);
    // Phát (F4) — chỉ điều hướng SAU khi trust đã resolve, cùng thứ tự với
    // hành vi gốc (trước khi có Player, click chỉ resolve trust).
    await this.router.navigate(['/player', row.sourceId, row.msgId]);
  }
}
