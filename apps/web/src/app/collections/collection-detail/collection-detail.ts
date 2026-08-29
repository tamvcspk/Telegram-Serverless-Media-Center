import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { getMediaItem, getSyncState, liveQuery, type MediaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { createEmptySyncState } from '@tsmc/shared-models';
import { from, map, switchMap } from 'rxjs';
import { PosterTile } from '../../shared/poster-tile/poster-tile';
import { pageTitleOverride } from '../../shell/page-title';

/** "src:<sourceId>/msg:<msgId>" — cùng quy ước khoá đã dùng ở ProgressEntry.k (ADR-0009) và collections.ts trước khi tách. */
function parseItemKey(key: string): { sourceId: string; msgId: number } | null {
  const match = /^src:(.+)\/msg:(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  return { sourceId: match[1] as string, msgId: Number(match[2]) };
}

/**
 * Route con `home/collections/:id` — chi tiết MỘT bộ sưu tập (item grid,
 * kéo-thả sắp xếp, gỡ item), tách ra khỏi `collections.ts` (giờ chỉ còn
 * danh sách tile). Vẫn dưới `MainShell`/Bottom Nav (không phải sub-page như
 * Settings) — đây là quyết định đã chốt, xem app.routes.ts.
 *
 * KHÔNG virtualize — `CdkDrag`/`cdkVirtualFor` không tương thích nhau
 * (virtual scroll recycle DOM node theo kiểu tái sử dụng, drag cần node ổn
 * định trong suốt thao tác kéo), và số phim trong một BST nhỏ (chục, không
 * phải nghìn) nên không cần.
 *
 * `pageTitleOverride` (shell/page-title.ts) được set NGAY KHI tên collection
 * resolve xong qua `effect()`, và PHẢI reset về `null` lúc destroy — nếu
 * không, tên BST cũ sẽ còn hiện trên toolbar một nhịp khi điều hướng sang
 * trang kế tiếp trước khi `NavigationEnd` của trang đó kịp cập nhật title
 * mặc định.
 */
@Component({
  selector: 'app-collection-detail',
  imports: [MatButtonModule, CdkDropList, CdkDrag, PosterTile],
  templateUrl: './collection-detail.html',
  styleUrl: './collection-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionDetail {
  private readonly client = createCoreWorkerClient();
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? ''
  });

  private readonly syncState = toSignal(from(liveQuery(() => getSyncState())), { initialValue: createEmptySyncState() });

  protected readonly collection = computed(() => {
    const found = this.syncState().collections[this.id()];
    return found && !found.deleted ? found : null;
  });

  private readonly itemKeys = computed(() => this.collection()?.items ?? []);

  protected readonly resolvedItems = toSignal(
    toObservable(this.itemKeys).pipe(switchMap((keys) => from(liveQuery(() => this.resolveKeys(keys))))),
    { initialValue: new Map<string, MediaRecord | undefined>() }
  );

  constructor() {
    effect(() => {
      const name = this.collection()?.name;
      pageTitleOverride.set(name ?? null);
    });
    this.destroyRef.onDestroy(() => pageTitleOverride.set(null));
  }

  private async resolveKeys(keys: string[]): Promise<Map<string, MediaRecord | undefined>> {
    const entries = await Promise.all(
      keys.map(async (key): Promise<[string, MediaRecord | undefined]> => {
        const parsed = parseItemKey(key);
        return [key, parsed ? await getMediaItem(parsed.sourceId, parsed.msgId) : undefined];
      })
    );
    return new Map(entries);
  }

  itemLabel(key: string): string {
    const record = this.resolvedItems().get(key);
    if (!record) {
      return '(không còn trong catalog cục bộ)';
    }
    return record.title ?? '(chưa có tên)';
  }

  trackByItem(_index: number, item: string): string {
    return item;
  }

  async onDrop(event: CdkDragDrop<string[]>): Promise<void> {
    const collection = this.collection();
    if (!collection || event.previousIndex === event.currentIndex) {
      return;
    }
    const items = [...collection.items];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    await this.client.reorderCollection(collection.id, items);
  }

  async onRemoveItem(item: string): Promise<void> {
    const collection = this.collection();
    if (!collection) {
      return;
    }
    await this.client.removeFromCollection(collection.id, item);
  }
}
