import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom, from, map } from 'rxjs';
import { createEmptySyncState } from '@tsmc/shared-models';
import { getMediaItem, getSyncState, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { debugLog, debugLogLines, isDebugEnabled } from '../debug/debug-log';
import { CompatWarningSheet, type CompatWarningSheetData } from './compat-warning-sheet/compat-warning-sheet';
import { floodWaitNotice } from './flood-wait-notice';
import { toVttText } from './subtitle-convert';

/** Track phụ đề đã convert xong, sẵn sàng gắn `<track>` — `url` là Blob URL, phải revoke lúc rời trang (xem `ngOnDestroy` qua `DestroyRef`). */
interface SubtitleTrack {
  lang: string;
  label: string;
  url: string;
}

/** `lang` trong `subs[]` là string tự do CLI ghi lại (catalog.ts `untrustedString(20)`), `"und"` khi phụ đề gốc không có tag ngôn ngữ (docs/changelog.md 2026-08-30) — không phải enum ISO để tra bảng đầy đủ, chỉ cần nhãn dễ đọc cho vài mã hay gặp. */
const SUBTITLE_LANG_LABELS: Record<string, string> = {
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',
  und: 'Không rõ ngôn ngữ'
};

function subtitleLabel(lang: string): string {
  return SUBTITLE_LANG_LABELS[lang] ?? lang.toUpperCase();
}

/**
 * `ref` (username/invite link, `SourceRef.ref`) → link mở thẳng đúng tin
 * nhắn đó trên Telegram — nút "Mở trên Telegram" ở `CompatWarningSheet`
 * (Màn hình 5). Xử lý đồng nhất cả ba dạng `ref` đang tồn tại trong repo:
 * `@username`, `t.me/username` (kênh cộng đồng), và `https://t.me/c/<id>`
 * (kênh riêng tự sinh lúc chọn từ picker, xem `sources/sources.ts`).
 */
function buildTelegramDeepLink(ref: string, msgId: number): string {
  const path = ref
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
  return `https://t.me/${path}/${msgId}`;
}

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
 * KHÔNG có UI chọn audio track riêng — trình duyệt tự lo (đúng lý do chọn
 * phương án C ở ADR-0005: "Bộ demux gốc của trình duyệt làm phần còn lại").
 * Phụ đề (`subs[]` của catalog item) là NGOẠI LỆ duy nhất: đó là message
 * RIÊNG (docs/catalog-spec.md), trình duyệt không tự "thấy" được — phải tải
 * document rời qua Core Worker rồi tự gắn `<track>`; việc CHỌN/bật-tắt giữa
 * các track vẫn để nguyên cho menu CC gốc của `<video controls>`, không tự
 * vẽ UI riêng.
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
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly snackBar = inject(MatSnackBar);
  private readonly client = createCoreWorkerClient();
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  private lastProgressSaveAt = 0;

  private readonly streamerReady = signal(false);
  protected readonly isReady = this.streamerReady.asReadonly();

  // Cổng cảnh báo tương thích (Màn hình 5) — video chỉ thật sự gắn `src` khi
  // CẢ SW đã sẵn sàng LẪN cổng này đã qua (compat undefined/full → qua ngay;
  // partial/unplayable → chờ user chọn "Vẫn thử phát" ở CompatWarningSheet).
  private readonly compatConfirmed = signal(false);
  protected readonly isPlayable = computed(() => this.isReady() && this.compatConfirmed());

  // Baseline chụp lúc component khởi tạo — effect() dưới đây chỉ show
  // snackbar cho notice MỚI xuất hiện SAU thời điểm này, không phải notice
  // còn sót lại từ một phiên phát trước đó (stream-bridge.ts sống xuyên suốt
  // trang, floodWaitNotice không tự reset khi chuyển sang video khác).
  private readonly initialFloodNotice = floodWaitNotice();

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

  private readonly subtitleTracks = signal<SubtitleTrack[]>([]);
  protected readonly subs = this.subtitleTracks.asReadonly();

  constructor() {
    if (this.debugEnabled) {
      debugLog(`Player mở: sourceId=${this.sourceId()} msgId=${this.msgId()} url=${this.streamUrl()}`);
    }
    void this.waitForServiceWorker();
    void this.checkCompat();
    void this.loadSubtitles();

    // Blob URL của mỗi track (URL.createObjectURL) sống ngoài GC của trình
    // duyệt cho tới khi tự revoke — component này bị huỷ mỗi lần chuyển
    // sang phim khác (route param đổi tạo component mới, không tái dùng),
    // không revoke ở đây sẽ rò bộ nhớ dần mỗi lần chuyển phim trong cùng tab.
    inject(DestroyRef).onDestroy(() => {
      for (const track of this.subtitleTracks()) {
        URL.revokeObjectURL(track.url);
      }
    });

    effect(() => {
      const notice = floodWaitNotice();
      if (notice && notice !== this.initialFloodNotice) {
        this.snackBar.open(notice.message, 'Đóng', { duration: 6000, verticalPosition: 'top' });
      }
    });
  }

  private async checkCompat(): Promise<void> {
    const item = await getMediaItem(this.sourceId(), this.msgId());
    const compat = item?.compat;
    if (compat !== 'partial' && compat !== 'unplayable') {
      this.compatConfirmed.set(true);
      return;
    }

    const state = await getSyncState();
    const source = state.sources[this.sourceId()];
    const deepLink = source ? buildTelegramDeepLink(source.ref, this.msgId()) : null;

    const sheetRef = this.bottomSheet.open<CompatWarningSheet, CompatWarningSheetData, 'play' | 'telegram'>(CompatWarningSheet, {
      disableClose: true,
      data: { compat, deepLink }
    });
    const result = await firstValueFrom(sheetRef.afterDismissed());
    if (result === 'play') {
      this.compatConfirmed.set(true);
      return;
    }
    if (result === 'telegram' && deepLink) {
      window.open(deepLink, '_blank', 'noopener');
    }
    this.close();
  }

  /**
   * Tải + convert từng phụ đề trong `subs[]` của catalog item (roadmap.md
   * "Player: chưa đọc/hiển thị subs[]") — chạy SONG SONG với checkCompat(),
   * KHÔNG chặn `isPlayable()`: phim vẫn phát được nếu phụ đề tải lỗi/chậm,
   * track chỉ xuất hiện thêm khi convert xong. Mỗi track lỗi (message đã bị
   * xoá, FLOOD_WAIT nghiêm trọng...) bị bỏ qua ĐỘC LẬP — một track hỏng không
   * được kéo theo mất luôn các track còn tốt.
   */
  private async loadSubtitles(): Promise<void> {
    const item = await getMediaItem(this.sourceId(), this.msgId());
    const subs = item?.subs ?? [];
    if (subs.length === 0) {
      return;
    }

    const tracks = await Promise.all(
      subs.map(async (sub): Promise<SubtitleTrack | undefined> => {
        const correlationId = `sub:${this.sourceId()}:${this.msgId()}:${sub.msgId}`;
        try {
          const buffer = await this.client.getSubtitleDocument(this.sourceId(), sub.msgId, correlationId);
          const blob = new Blob([toVttText(buffer)], { type: 'text/vtt' });
          return { lang: sub.lang, label: subtitleLabel(sub.lang), url: URL.createObjectURL(blob) };
        } catch (err) {
          if (this.debugEnabled) {
            debugLog(`Tải phụ đề lỗi (lang=${sub.lang} msgId=${sub.msgId}): ${err instanceof Error ? err.message : String(err)}`);
          }
          return undefined;
        }
      })
    );
    this.subtitleTracks.set(tracks.filter((track): track is SubtitleTrack => track !== undefined));
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
