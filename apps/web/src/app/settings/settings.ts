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
import { countOutbox, getSyncState, liveQuery } from '@tsmc/core-storage';
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
}
