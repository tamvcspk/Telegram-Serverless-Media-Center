import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { getMediaItem, getSyncState, liveQuery, listAllMedia, type MediaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { Collection, SourceRef } from '@tsmc/shared-models';
import { from, switchMap } from 'rxjs';
import { observeElementResize } from '../shared/element-resize';
import { BrowseStore, type BrowseSort } from './browse.store';
import { MediaCard } from './media-card/media-card';
import { ItemDetailSheet, type ItemDetailSheetData } from './item-detail-sheet/item-detail-sheet';

interface BrowseParams {
  sourceId: string | null;
  query: string;
  sort: BrowseSort;
}

// Ngưỡng RỘNG TỐI THIỂU để quyết định số cột — card thật SẼ RỘNG HƠN giá trị
// này vì cột dùng `1fr` (co giãn lấp đầy hết hàng, không chừa khoảng trống
// bên phải). Vì bề rộng card giờ BIẾN THIÊN liên tục theo bề rộng màn hình
// (không còn là hằng số), chiều cao poster (aspect-ratio 2/3, xem
// PosterTile) — và do đó `itemSize` của virtual scroll — KHÔNG THỂ là hằng
// số biết trước nữa, phải tính lại mỗi lần đo (ResizeObserver) rồi bind
// động vào `[itemSize]` (browse.html). CDK hỗ trợ đổi `itemSize` runtime
// thật: `CdkFixedSizeVirtualScroll.ngOnChanges()` gọi
// `_scrollStrategy.updateItemAndBufferSize()` mỗi khi input đổi giá trị —
// không phải hack, đây là cơ chế chính thức.
const MIN_CARD_WIDTH_PX = 140;
const CARD_GAP_PX = 12;
const CARD_ASPECT_RATIO = 3 / 2; // height/width poster — khớp `aspect-ratio: 2/3` ở poster-tile.scss
// Khối DƯỚI poster (title/meta/badge) có chiều cao CỐ ĐỊNH bất kể bề rộng
// card — khớp media-card.scss (3 gap 6px + title 20 + meta 18 + badge 22).
// Đổi số ở 1 trong 2 file PHẢI đổi khớp số ở file kia.
const CARD_META_HEIGHT_PX = 78;
const ROW_GAP_PX = 16;
const INITIAL_ROW_HEIGHT_PX = Math.round(MIN_CARD_WIDTH_PX * CARD_ASPECT_RATIO) + CARD_META_HEIGHT_PX + ROW_GAP_PX;
// Khớp `padding: 0 12px` của `.grid-row` (browse.scss) — trừ ra trước khi
// đo, không thì cột cuối tràn ra ngoài padding.
const GRID_HORIZONTAL_PADDING_PX = 12 * 2;

async function activeSourceIds(): Promise<Set<string>> {
  const state = await getSyncState();
  return new Set(Object.values(state.sources).filter((s) => !s.removed).map((s) => s.id));
}

function sortRows(rows: MediaRecord[], sort: BrowseSort): MediaRecord[] {
  return [...rows].sort((a, b) =>
    sort === 'year' ? (b.year ?? 0) - (a.year ?? 0) : (a.title ?? '').localeCompare(b.title ?? '', 'vi')
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    return items.length > 0 ? [items.slice()] : [];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Duyệt phim (F3.1) + lọc theo nguồn (F3.2) + tìm kiếm MiniSearch (F3.3,
 * ADR-0008) — nay dạng lưới kiểu Netflix thay vì list. Không gõ tìm kiếm →
 * đọc thẳng IndexedDB qua `liveQuery` (đường đọc, ADR-0007), có gõ → RPC
 * `searchMedia()` chạy trong Core Worker rồi bulk-resolve item thật từ Dexie
 * theo đúng thứ tự relevance trả về.
 *
 * `cdk-virtual-scroll-viewport` virtualize THEO HÀNG, không theo từng phim —
 * `rowChunks` gộp `rows()` thành mảng con theo `store.columns()` (số cột đo
 * bằng `ResizeObserver`), mỗi chunk render thành một hàng CSS Grid chứa N
 * `<app-media-card>` co giãn lấp đầy hết bề rộng (`1fr`, không chừa khoảng
 * trống cuối hàng). Vì bề rộng card biến thiên theo màn hình, `rowHeightPx`
 * cũng tính lại mỗi lần đo và bind động vào `itemSize` — xem comment hằng số
 * phía trên để biết vì sao CDK chấp nhận việc này ở runtime. Click card mở
 * `ItemDetailSheet` — thao tác thật (Phát/Sửa metadata/BST) đã dời hết vào
 * đó, `resolveItemTrust()` cũng gọi từ sheet lúc mở thay vì ở đây.
 */
@Component({
  selector: 'app-browse',
  imports: [ScrollingModule, MatChipsModule, MatFormFieldModule, MatInputModule, MediaCard],
  providers: [BrowseStore],
  templateUrl: './browse.html',
  styleUrl: './browse.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Browse {
  private readonly client = createCoreWorkerClient();
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(BrowseStore);

  // Đo `<section class="browse">` (LUÔN render, #gridMeasure) — KHÔNG đo
  // `cdk-virtual-scroll-viewport`: viewport đó chỉ tồn tại trong DOM khi
  // `rows().length > 0` (nhánh `@else`), nên bug THẬT đã gặp là
  // `afterNextRender` chạy lượt đầu lúc `rows()` còn rỗng (liveQuery async
  // chưa resolve) → element chưa tồn tại → observer không bao giờ được gắn
  // → `columns`/`rowHeightPx` kẹt mãi ở giá trị mặc định (2 cột) bất kể màn
  // hình rộng bao nhiêu. `.browse` không có padding riêng nên clientWidth
  // của nó đúng bằng bề rộng khả dụng cho grid, và nó luôn có mặt ngay từ
  // lượt render đầu tiên.
  protected readonly gridMeasure = viewChild<ElementRef<HTMLElement>>('gridMeasure');

  protected readonly sources = toSignal(
    from(liveQuery(async (): Promise<SourceRef[]> => Object.values((await getSyncState()).sources).filter((s) => !s.removed))),
    { initialValue: [] as SourceRef[] }
  );

  // Truyền thẳng signal này vào ItemDetailSheetData.collections — sheet đọc
  // reactive từ cùng liveQuery, không mở thêm liveQuery trùng.
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

  protected readonly rowChunks = computed(() => chunk(this.rows(), this.store.columns()));
  protected readonly gridTemplateColumns = computed(() => `repeat(${this.store.columns()}, 1fr)`);
  protected readonly rowHeightPx = signal(INITIAL_ROW_HEIGHT_PX);

  constructor() {
    afterNextRender(() => {
      const element = this.gridMeasure()?.nativeElement;
      if (!element) {
        return;
      }
      // Luôn đo lại `element.clientWidth` trực tiếp (không dùng
      // `entries[0].contentRect`) — contentRect loại trừ padding còn
      // clientWidth thì không, dùng lẫn 2 nguồn sẽ lệch đúng bằng
      // GRID_HORIZONTAL_PADDING_PX giữa lần đo đầu và các lần đo do resize.
      const update = (): void => {
        const available = Math.max(0, element.clientWidth - GRID_HORIZONTAL_PADDING_PX);
        const columns = Math.max(1, Math.floor((available + CARD_GAP_PX) / (MIN_CARD_WIDTH_PX + CARD_GAP_PX)));
        // Card THẬT rộng hơn MIN_CARD_WIDTH_PX — cột `1fr` chia đều phần
        // thừa, không chừa khoảng trống cuối hàng (khác thiết kế cũ).
        const cardWidth = (available - (columns - 1) * CARD_GAP_PX) / columns;
        this.store.setColumns(columns);
        this.rowHeightPx.set(Math.round(cardWidth * CARD_ASPECT_RATIO) + CARD_META_HEIGHT_PX + ROW_GAP_PX);
      };
      update();
      // ResizeObserver DÙNG CHUNG toàn app (shared/element-resize.ts) —
      // không tự `new ResizeObserver()` riêng ở đây.
      const stopObserving = observeElementResize(element, update);
      this.destroyRef.onDestroy(stopObserving);
    });
  }

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

  trackByChunk(index: number): number {
    return index;
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

  onCardOpen(row: MediaRecord): void {
    const source = this.sources().find((s) => s.id === row.sourceId) ?? null;
    this.bottomSheet.open<ItemDetailSheet, ItemDetailSheetData>(ItemDetailSheet, {
      data: { row, source, collections: this.collections }
    });
  }
}
