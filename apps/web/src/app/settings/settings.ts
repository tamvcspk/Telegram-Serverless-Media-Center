import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CHUNK_CACHE_NAME, type TelegramUserSummary } from '@tsmc/shared-models';
import { countOutbox, getSyncMeta, getSyncState, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { firstValueFrom, from } from 'rxjs';
import { currentUser } from '../shell/current-user';
import { isDebugEnabled, setDebugEnabled } from '../debug/debug-log';
import { LogoutConfirmSheet, type LogoutConfirmSheetData } from './logout-confirm-sheet/logout-confirm-sheet';

// ADR-0006 §3: "Trần cứng mặc định là 4 ... cho phép user nâng lên 8". Không
// import từ @tsmc/core-download (apps/web KHÔNG được import core-download
// trực tiếp — chỉ qua worker-host, CLAUDE.md bất biến #4) — hai số này ổn
// định vì đã ghim trong một ADR Accepted, chấp nhận trùng lặp thay vì mở một
// đường re-export xuyên boundary chỉ để đỡ hai hằng số.
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;

// ADR-0009 "Compaction": mặc định 7 ngày, KHÔNG đổi ở đây (chỉ thêm khả
// năng chỉnh — xem ADR-0009 addendum 2026-09-15). Trần UI 1-30 ngày hẹp hơn
// trần phòng thủ thật sự ở `libs/core-sync/src/compaction.ts` (1-90, kẹp
// giá trị hỏng/đồng bộ từ thiết bị khác) — trần UI chỉ giữ slider trong
// khoảng còn có ý nghĩa thực tế cho một app cá nhân.
const DEFAULT_COMPACTION_MAX_AGE_DAYS = 7;
const MIN_COMPACTION_MAX_AGE_DAYS = 1;
const MAX_COMPACTION_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** ADR-0009 Hệ quả: "thêm chỉ báo tình trạng đồng bộ trong Cài đặt" —
 * `undefined` nghĩa là CHƯA TỪNG nén (chưa tự phát sinh compaction nào,
 * `SyncMetaRecord.lastSnapshotAt` chỉ được ghi lúc `maybeCompact()` nén
 * thành công lần đầu, không phải lúc hydrate) — hiện rõ "chưa từng nén"
 * thay vì bịa ra một số ngày sai. */
function formatCompactionAge(lastSnapshotAt: number | undefined): string {
  if (lastSnapshotAt === undefined) {
    return 'chưa từng nén';
  }
  const days = Math.floor((Date.now() - lastSnapshotAt) / MS_PER_DAY);
  if (days <= 0) {
    return 'đã nén hôm nay';
  }
  return `chưa nén trong ${days} ngày`;
}

function displayName(user: TelegramUserSummary): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.username || user.id;
}

function initials(user: TelegramUserSummary): string {
  const name = displayName(user);
  return name.slice(0, 1).toUpperCase() || '?';
}

/**
 * Cài đặt, Tài khoản & Debug (Màn hình 7, docs/ux-design.md) — sub-page
 * KHÔNG nằm trong Bottom Nav (ui-conventions §6), header `<` quay lại. Bốn
 * khối đúng thứ tự mockup: Tài khoản (đăng xuất qua LogoutConfirmSheet, xem
 * comment ở đó) → Lưu trữ (Cache Storage `tsmc-chunks-v1`, KHÔNG phải
 * IndexedDB media — đó là catalog cần giữ để duyệt) → Mạng (slider trần AIMD
 * 4-8, ADR-0006 §3 "known gap" đóng ở slice này qua
 * `client.setMaxConcurrency()`) → Debug (cờ log cục bộ, có hiệu lực sau khi
 * tải lại — xem debug-log.ts).
 *
 * **Khối "Đồng bộ" (thêm 2026-09-15) — thứ NĂM, KHÔNG thuộc bốn khối gốc của
 * mockup Màn hình 7 (Tài khoản/Lưu trữ/Mạng/Chẩn đoán) — đóng gap ghi sẵn ở
 * ADR-0009 §
 * Hệ quả ("Kênh state có thể phình nếu compaction không chạy... → thêm chỉ
 * báo tình trạng đồng bộ trong Cài đặt") + roadmap.md brainstorm 2026-08-29:
 * chỉ báo `compactionAgeLabel` (đọc `SyncMetaRecord.lastSnapshotAt` qua
 * liveQuery) + slider chỉnh ngưỡng nén-theo-tuổi (mặc định VẪN 7 ngày, ADR-
 * 0009 — chỉ THÊM khả năng chỉnh, không đổi mặc định, xem ADR-0009 addendum
 * 2026-09-15). Ngưỡng >200 event vẫn là lưới an toàn cứng, không có UI cho
 * nó (đúng roadmap.md § Sync & dữ liệu).**
 *
 * `currentUser` đọc từ signal do `authGuard` set (xem shell/current-user.ts)
 * — route này nằm trong `canActivate: [authGuard]` nên signal luôn có giá
 * trị khi component khởi tạo bình thường.
 */
@Component({
  selector: 'app-settings',
  imports: [MatButtonModule, MatDividerModule, MatSliderModule, MatSlideToggleModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Settings {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly client = createCoreWorkerClient();

  protected readonly user = currentUser;
  protected readonly displayName = displayName;
  protected readonly initials = initials;

  protected readonly minConcurrency = MIN_CONCURRENCY;
  protected readonly maxConcurrency = MAX_CONCURRENCY;

  protected readonly pendingOutboxCount = toSignal(from(liveQuery(() => countOutbox())), { initialValue: 0 });

  protected readonly cacheUsageBytes = signal<number | null>(null);
  protected readonly cacheUsageLabel = computed(() => {
    const bytes = this.cacheUsageBytes();
    return bytes === null ? 'đang tính…' : formatBytes(bytes);
  });
  protected readonly clearingCache = signal(false);
  protected readonly clearCacheError = signal<string | null>(null);

  // Đọc thẳng IndexedDB qua liveQuery (đường đọc, ADR-0007) — cùng SyncState
  // mọi component khác đọc, không phải state riêng của Settings. Chưa từng
  // lưu (chưa đồng bộ từ thiết bị nào) → mặc định cận dưới 4 (ADR-0006 §3),
  // khớp giá trị `createDownloadEngine()` dùng khi chưa có setting nào
  // (worker-host/core-worker.ts).
  private readonly savedConcurrency = toSignal(
    from(liveQuery(async () => (await getSyncState()).settings['maxConcurrency']?.val as number | undefined)),
    { initialValue: undefined }
  );
  protected readonly concurrency = computed(() => this.savedConcurrency() ?? MIN_CONCURRENCY);
  protected readonly concurrencyPending = signal(false);
  protected readonly concurrencyError = signal<string | null>(null);

  protected readonly minCompactionMaxAgeDays = MIN_COMPACTION_MAX_AGE_DAYS;
  protected readonly maxCompactionMaxAgeDays = MAX_COMPACTION_MAX_AGE_DAYS;

  // Cùng cách đọc `savedConcurrency` ở trên — setting đồng bộ qua kênh state
  // (ADR-0009), key `compactionMaxSnapshotAgeDays` PHẢI khớp literal string
  // `libs/core-sync/src/compaction.ts::readConfiguredMaxSnapshotAgeMs()`
  // dùng (quy ước lặp lại string, không export hằng dùng chung — xem doc
  // comment ở đó).
  private readonly savedCompactionMaxAgeDays = toSignal(
    from(liveQuery(async () => (await getSyncState()).settings['compactionMaxSnapshotAgeDays']?.val as number | undefined)),
    { initialValue: undefined }
  );
  protected readonly compactionMaxAgeDays = computed(() => this.savedCompactionMaxAgeDays() ?? DEFAULT_COMPACTION_MAX_AGE_DAYS);
  protected readonly compactionMaxAgePending = signal(false);
  protected readonly compactionMaxAgeError = signal<string | null>(null);

  // `SyncMetaRecord.lastSnapshotAt` — CHỈ được ghi lúc `maybeCompact()` nén
  // thành công lần đầu (không phải lúc hydrate), nên `undefined` là trạng
  // thái bình thường cho một tài khoản mới/dùng nhẹ (log chưa bao giờ đủ 200
  // event hoặc 7 ngày để tự nén) — `formatCompactionAge()` hiện đúng nghĩa
  // "chưa từng nén" cho case này, không bịa số ngày.
  private readonly lastSnapshotAt = toSignal(from(liveQuery(async () => (await getSyncMeta()).lastSnapshotAt)), { initialValue: undefined });
  protected readonly compactionAgeLabel = computed(() => formatCompactionAge(this.lastSnapshotAt()));

  protected readonly debugEnabled = signal(isDebugEnabled());

  constructor() {
    void this.refreshCacheUsage();
  }

  onBack(): void {
    this.location.back();
  }

  async onOpenLogout(): Promise<void> {
    const sheetRef = this.bottomSheet.open<LogoutConfirmSheet, LogoutConfirmSheetData, 'success'>(LogoutConfirmSheet, {
      disableClose: true,
      data: { pendingOutboxCount: this.pendingOutboxCount() }
    });
    const result = await firstValueFrom(sheetRef.afterDismissed());
    if (result === 'success') {
      await this.router.navigateByUrl('/login');
    }
  }

  async onClearCache(): Promise<void> {
    this.clearingCache.set(true);
    this.clearCacheError.set(null);
    try {
      await caches.delete(CHUNK_CACHE_NAME);
      await this.refreshCacheUsage();
    } catch (err) {
      this.clearCacheError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.clearingCache.set(false);
    }
  }

  private async refreshCacheUsage(): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.estimate) {
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      this.cacheUsageBytes.set(estimate.usage ?? 0);
    } catch {
      // Một số trình duyệt/chế độ riêng tư từ chối navigator.storage.estimate()
      // — không phải lỗi cần chặn màn Cài đặt, chỉ giữ nhãn "đang tính…".
    }
  }

  async onConcurrencyChange(value: number): Promise<void> {
    this.concurrencyPending.set(true);
    this.concurrencyError.set(null);
    try {
      await this.client.setMaxConcurrency(value);
    } catch (err) {
      this.concurrencyError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.concurrencyPending.set(false);
    }
  }

  onDebugToggle(checked: boolean): void {
    setDebugEnabled(checked);
    this.debugEnabled.set(checked);
  }

  /** Ghi qua `setSetting()` chung (không phải RPC riêng như
   * `setMaxConcurrency()` — ngưỡng này không cần áp dụng NGAY cho một tiến
   * trình nền nào đang chạy trong Core Worker, `maybeCompact()` tự đọc lại
   * `SyncState.settings` mỗi lượt kiểm tra định kỳ, xem
   * `libs/core-sync/src/compaction.ts`). Không tự clamp ở đây — kẹp thật sự
   * (đủ chống giá trị hỏng) nằm ở `readConfiguredMaxSnapshotAgeMs()`, slider
   * `[min,max]` đã đủ chặn input hợp lệ từ UI này. */
  async onCompactionMaxAgeChange(days: number): Promise<void> {
    this.compactionMaxAgePending.set(true);
    this.compactionMaxAgeError.set(null);
    try {
      await this.client.setSetting('compactionMaxSnapshotAgeDays', days);
    } catch (err) {
      this.compactionMaxAgeError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.compactionMaxAgePending.set(false);
    }
  }
}
