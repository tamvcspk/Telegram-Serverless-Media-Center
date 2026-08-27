import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { createEmptySyncState } from '@tsmc/shared-models';
import { getSyncState, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { from } from 'rxjs';
import { debugLog, debugLogLines, isDebugEnabled } from '../debug/debug-log';

/** Chỉ ghi lại vị trí xem dở tối đa mỗi khoảng này — timeupdate bắn ~4 lần/giây, ghi mỗi lần là quá nhiều event vào outbox (ADR-0009). */
const PROGRESS_SAVE_INTERVAL_MS = 5000;

/**
 * Chờ SW active TRƯỚC khi gắn `src` cho `<video>` — phát hiện thật: lần
 * ĐẦU TIÊN một tab mở app, SW đăng ký/cài đặt xong vẫn cần một nhịp để
 * activate + `clients.claim()` (xem sw/sw.ts) mới thực sự điều khiển được
 * tab đó; gắn src quá sớm khiến request `/_stream/*` đi thẳng ra mạng (404),
 * player im lặng không phát được, không lỗi rõ ràng — đúng triệu chứng đã
 * gặp. Có timeout để không treo UI vô thời hạn nếu SW không khả dụng
 * (Firefox Private Mode — ADR-0005 §Hệ quả, fallback A chưa xây).
 */
const SERVICE_WORKER_READY_TIMEOUT_MS = 5000;

/**
 * Player tối thiểu (F4, ADR-0005) — `<video>` trỏ thẳng vào
 * `/_stream/{sourceId}/{msgId}` (SW giả lập HTTP origin, xem sw/sw.ts).
 * KHÔNG có UI chọn phụ đề/audio track riêng — trình duyệt tự lo (đúng lý do
 * chọn phương án C ở ADR-0005: "Bộ demux gốc của trình duyệt làm phần còn lại").
 */
@Component({
  selector: 'app-player',
  imports: [],
  templateUrl: './player.html',
  styleUrl: './player.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Player {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly client = createCoreWorkerClient();
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  private lastProgressSaveAt = 0;

  private readonly streamerReady = signal(false);
  protected readonly isReady = this.streamerReady.asReadonly();

  protected readonly debugEnabled = isDebugEnabled();
  protected readonly debugLines = debugLogLines;

  protected readonly sourceId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('sourceId') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('sourceId') ?? '' }
  );
  protected readonly msgId = toSignal(
    this.route.paramMap.pipe(map((params) => Number(params.get('msgId') ?? '0'))),
    { initialValue: Number(this.route.snapshot.paramMap.get('msgId') ?? '0') }
  );

  protected readonly streamUrl = computed(() => `/_stream/${this.sourceId()}/${this.msgId()}`);
  protected readonly progressKey = computed(() => `src:${this.sourceId()}/msg:${this.msgId()}`);

  private readonly syncState = toSignal(from(liveQuery(() => getSyncState())), { initialValue: createEmptySyncState() });
  protected readonly resumeFrom = computed(() => {
    const entry = this.syncState().progress[this.progressKey()];
    return entry && !entry.cleared ? entry.p : undefined;
  });

  constructor() {
    if (this.debugEnabled) {
      debugLog(`Player mở: sourceId=${this.sourceId()} msgId=${this.msgId()} url=${this.streamUrl()}`);
    }
    void this.waitForServiceWorker();
  }

  private async waitForServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      this.streamerReady.set(true);
      return;
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SERVICE_WORKER_READY_TIMEOUT_MS));
    await Promise.race([navigator.serviceWorker.ready.then(() => undefined), timeout]);
    this.streamerReady.set(true);
  }

  onLoadedMetadata(): void {
    const video = this.videoRef()?.nativeElement;
    if (this.debugEnabled && video) {
      debugLog(`video loadedmetadata: duration=${video.duration}s readyState=${video.readyState}`);
    }
    const resumeFrom = this.resumeFrom();
    if (video && resumeFrom) {
      video.currentTime = resumeFrom;
    }
  }

  onLoadStart(): void {
    if (this.debugEnabled) {
      debugLog('video loadstart');
    }
  }

  onCanPlay(): void {
    if (this.debugEnabled) {
      debugLog('video canplay');
    }
  }

  onPlaying(): void {
    if (this.debugEnabled) {
      debugLog('video playing');
    }
  }

  onWaiting(): void {
    if (this.debugEnabled) {
      debugLog('video waiting (đang chờ buffer)');
    }
  }

  onStalled(): void {
    if (this.debugEnabled) {
      debugLog('video stalled (không tải thêm được dữ liệu)');
    }
  }

  onVideoError(): void {
    const error = this.videoRef()?.nativeElement.error;
    debugLog(`video error: code=${error?.code ?? '?'} message="${error?.message || '(không có)'}"`);
  }

  onTimeUpdate(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) {
      return;
    }
    const now = Date.now();
    if (now - this.lastProgressSaveAt < PROGRESS_SAVE_INTERVAL_MS) {
      return;
    }
    this.lastProgressSaveAt = now;
    void this.client.setProgress(this.progressKey(), video.currentTime);
  }

  onPause(): void {
    const video = this.videoRef()?.nativeElement;
    if (video) {
      void this.client.setProgress(this.progressKey(), video.currentTime);
    }
  }

  onEnded(): void {
    void this.client.clearProgress(this.progressKey());
  }

  close(): void {
    // '/' giờ redirect thẳng tới 'login' (app.routes.ts) — về '/home' mới
    // đúng route MainShell, tránh vòng qua lại login khi đã đăng nhập.
    void this.router.navigate(['/home']);
  }
}
