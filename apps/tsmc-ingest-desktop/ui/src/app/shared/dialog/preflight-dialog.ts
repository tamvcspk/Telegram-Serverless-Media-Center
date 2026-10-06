import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import {
  AUDIO_BITRATE_CHOICES_BPS,
  CALIBRATED_SAFETY_MARGIN,
  calibrateTargetBps,
  chooseAutoResolution,
  chooseDefaultStrategy,
  computeTargetVideoBitrateBps,
  estimateFromSamples,
  estimateReencodeRangeBytes,
  isBelowAbrFloor,
  isReencodeFutile,
  qualityLevel,
  REENCODE_AUDIO_BITRATE_BPS,
  reencodeQuality,
  rescaleEstimateBytes,
  resolutionChoices,
  resolveAbrFloor,
  SPLIT_SAFETY_MARGIN,
  type QualityLevel,
  type ReencodeEstimate,
  type ReencodePlan,
  type SizeCapStrategy
} from '@tsmc/core-ingest';
import { cancelUpload, describeIngestError, estimateReencode, loadUiPrefs, saveUiPrefs, toIngestRpcError } from '../../core/ingest-rpc';

export interface PreflightDialogItem {
  path: string;
  name: string;
  /** Dung lượng file NGUỒN (cũng là dự đoán đầu ra của Hạng A/B/C). */
  sourceBytes: number;
  durationSec: number;
  /** Số liệu video nguồn — 0 nếu probe không đọc được (chỉ báo chất lượng/tự
   * chọn độ phân giải tắt, không chặn gì). */
  width: number;
  height: number;
  fps: number;
  /** Hạng D: video bắt buộc re-encode, không có đường stream-copy để chia. */
  mustReencode: boolean;
}

export interface PreflightDialogData {
  items: PreflightDialogItem[];
  maxUploadBytes: number;
}

/** Một file ĐƯỢC chọn xử lý: nén lại (kèm tham số) hoặc chia phần (ADR-0022).
 * File không có trong `choices` bị bỏ qua lượt này (ở lại bảng metadata). */
export type PreflightChoice = { path: string; strategy: 'reencode'; plan: ReencodePlan } | { path: string; strategy: 'split' };

export interface PreflightDialogResult {
  choices: PreflightChoice[];
}

type ItemStrategy = 'reencode' | 'split' | 'skip';

interface ItemState {
  strategy: ItemStrategy;
  /** Kích thước đầu ra mục tiêu (trần cho bitrate) — slider ở panel Nâng cao. */
  sizeBytes: number;
  /** `undefined` = giữ độ phân giải gốc. */
  maxHeight: number | undefined;
  audioBps: number;
  /** Kết quả "ước tính chính xác" — gắn với plan đã dùng (`planKey`) để biết
   * khi nào hết hiệu lực vì user đổi tuỳ chọn. `extrapolated`: số dung lượng là
   * ngoại suy sau khi tự hiệu chỉnh target, CHƯA đo lại. */
  estimate: { planKey: string; value: ReencodeEstimate; extrapolated: boolean } | null;
  /** Target đã TỰ hiệu chỉnh theo mẫu thử (ghi đè công thức từ `sizeBytes`, margin 0.955) — xoá khi user đổi tuỳ chọn. */
  targetOverrideBps: number | null;
  estimatingTaskId: string | null;
  estimateError: string | null;
}

const QUALITY_LABEL: Record<QualityLevel, string> = {
  low: 'thấp — dễ lộ block ở cảnh chuyển động',
  ok: 'trung bình',
  good: 'tốt'
};

/** Bước TIỀN KIỂM vượt trần upload (Giai đoạn 0 → 2, ADR-0017 § addendum
 * 2026-09-19 "kế hoạch") — MỘT dialog cho cả batch, hỏi TRƯỚC khi file nào bắt
 * đầu xử lý. Mỗi file: thẻ "Nén lại"/"Chia phần"/"Bỏ qua" kèm thời gian + dung
 * lượng dự kiến, nút "Ước tính chính xác" (encode thử, đo thật), và panel
 * "Nâng cao" (kích thước mục tiêu / độ phân giải / audio + chỉ báo bits/pixel).
 * Chế độ Tự động = giá trị khởi tạo của panel: kích thước = trần, độ phân giải
 * = cao nhất mà chất lượng còn ≥ ngưỡng (Option D).
 *
 * "Chia phần" (Giai đoạn 4, ADR-0022): stream-copy, cắt tại keyframe, mỗi phần là
 * video Telegram độc lập — chỉ có với Hạng A/B/C (Hạng D phải re-encode nên
 * thẻ bị khoá). Thẻ được chọn sẵn theo gợi ý mặc định (`chooseDefaultStrategy`).
 * Trạng thái mở/đóng panel Nâng cao lưu ở app-data (Rust), KHÔNG `localStorage`
 * (tách theo origin, bài học 2026-09-11) — MỘT cờ chung cho mọi file.
 *
 * Đóng bằng cách khác (Esc/ra ngoài/"Huỷ upload") → `null`: `startUpload()`
 * dừng hẳn, mọi file còn nguyên trong bảng metadata. KHÔNG tự mở — luôn qua
 * `DialogService.confirmPreflight()`. */
@Component({
  selector: 'app-preflight-dialog',
  imports: [MatButtonModule, MatButtonToggleModule, MatDialogModule, MatProgressSpinnerModule, MatSliderModule],
  templateUrl: './preflight-dialog.html',
  styleUrl: './preflight-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightDialog implements OnInit {
  protected readonly data = inject<PreflightDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<PreflightDialog, PreflightDialogResult>>(MatDialogRef);

  protected readonly maxGb = (this.data.maxUploadBytes / 1_000_000_000).toFixed(2);
  protected readonly audioChoices = AUDIO_BITRATE_CHOICES_BPS;
  /** Cận dưới của slider kích thước: 10% trần (dưới đó bitrate chạm sàn). */
  protected readonly sliderMinBytes = Math.round((this.data.maxUploadBytes * 0.1) / 10_000_000) * 10_000_000;
  protected readonly sliderStepBytes = 10_000_000;

  protected readonly advancedOpen = signal(false);
  private readonly states = signal<ReadonlyMap<string, ItemState>>(new Map(this.data.items.map((i) => [i.path, { ...this.autoState(i), strategy: this.initialStrategy(i) }] as const)));
  /** Gợi ý mặc định theo ADR-0017 quyết định #1 — hiện làm nhãn "Gợi ý" ở thẻ. */
  protected readonly suggestions = new Map<string, SizeCapStrategy | null>(
    this.data.items.map((i) => [i.path, chooseDefaultStrategy({ sourceBytes: i.sourceBytes, maxUploadBytes: this.data.maxUploadBytes, mustReencode: i.mustReencode })] as const)
  );
  protected readonly anyEstimating = computed(() => [...this.states().values()].some((s) => s.estimatingTaskId !== null));
  /** Số file đang chọn nén lại mà target dưới mức sàn ABR — chặn cứng nút Tiếp tục tới khi hạ độ phân giải hoặc bỏ qua. */
  protected readonly blockedCount = computed(() => this.data.items.filter((i) => this.state(i.path).strategy === 'reencode' && this.belowFloor(i)).length);
  /** Số file đang chọn nén lại mà dung lượng đã đo/dự kiến vượt trần — cũng chặn "Tiếp tục". */
  protected readonly overCapCount = computed(() => this.data.items.filter((i) => this.state(i.path).strategy === 'reencode' && this.overCap(i)).length);
  protected readonly selectedCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'reencode').length);
  protected readonly splitCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'split').length);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      // Đóng dialog giữa lúc đang encode thử → dừng ngay, không để Rust chạy tiếp ngầm.
      for (const s of this.states().values()) {
        if (s.estimatingTaskId !== null) {
          void cancelUpload(s.estimatingTaskId).catch(() => undefined);
        }
      }
    });
  }

  ngOnInit(): void {
    void loadUiPrefs()
      .then((prefs) => this.advancedOpen.set(prefs.preflight_advanced_open))
      .catch(() => undefined);
  }

  /** Chiến lược chọn sẵn: gợi ý mặc định (ADR-0017 quyết định #1), Hạng D luôn nén lại. */
  private initialStrategy(item: PreflightDialogItem): ItemStrategy {
    return this.canSplit(item) ? (chooseDefaultStrategy({ sourceBytes: item.sourceBytes, maxUploadBytes: this.data.maxUploadBytes, mustReencode: false }) ?? 'reencode') : 'reencode';
  }

  /** Hạng D không có đường stream-copy để chia. */
  protected canSplit(item: PreflightDialogItem): boolean {
    return !item.mustReencode;
  }

  /** Số phần TỐI THIỂU (chia đều) — thực tế `planSplit()` có thể cần thêm một phần nếu keyframe thưa. */
  protected splitPartCount(item: PreflightDialogItem): number {
    return Math.max(2, Math.ceil(item.sourceBytes / (this.data.maxUploadBytes * SPLIT_SAFETY_MARGIN)));
  }

  /** Chế độ Tự động (Option D): kích thước = trần, độ phân giải = cao nhất còn đạt ngưỡng chất lượng. */
  private autoState(item: PreflightDialogItem): ItemState {
    const audioBps = REENCODE_AUDIO_BITRATE_BPS;
    const videoBps = computeTargetVideoBitrateBps(this.data.maxUploadBytes, item.durationSec, audioBps);
    return {
      strategy: 'reencode',
      sizeBytes: this.data.maxUploadBytes,
      maxHeight: chooseAutoResolution({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: videoBps }),
      audioBps,
      estimate: null,
      targetOverrideBps: null,
      estimatingTaskId: null,
      estimateError: null
    };
  }

  private patch(path: string, change: Partial<ItemState>): void {
    this.states.update((current) => {
      const prev = current.get(path);
      if (!prev) {
        return current;
      }
      const next = new Map(current);
      next.set(path, { ...prev, ...change });
      return next;
    });
  }

  protected state(path: string): ItemState {
    return this.states().get(path) as ItemState;
  }

  protected plan(item: PreflightDialogItem): ReencodePlan {
    const s = this.state(item.path);
    return {
      targetVideoBitrateBps: this.videoBps(item),
      maxHeight: s.maxHeight,
      audioBitrateBps: s.audioBps === REENCODE_AUDIO_BITRATE_BPS ? undefined : s.audioBps
    };
  }

  private videoBps(item: PreflightDialogItem): number {
    const s = this.state(item.path);
    return s.targetOverrideBps ?? computeTargetVideoBitrateBps(s.sizeBytes, item.durationSec, s.audioBps);
  }

  /** Target dưới mức sàn ABR của `h264_mf` → file ra to hơn dự kiến, hình sụp (ADR-0017 § addendum 2026-10-04). */
  protected belowFloor(item: PreflightDialogItem): boolean {
    return isBelowAbrFloor({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: this.videoBps(item), maxHeight: this.state(item.path).maxHeight });
  }

  /** Dung lượng đã đo/dự kiến (sau "Ước tính chính xác") vượt trần upload. Chưa đo thì không biết → `false`. */
  protected overCap(item: PreflightDialogItem): boolean {
    const exact = this.validEstimate(item);
    return exact !== null && exact.estimatedBytes > this.data.maxUploadBytes;
  }

  /** Nén lại gần như không giảm gì so với nguồn (target ≥ ~90% bitrate video nguồn). */
  protected futile(item: PreflightDialogItem): boolean {
    return isReencodeFutile({ targetVideoBitrateBps: this.videoBps(item), sourceBytes: item.sourceBytes, durationSec: item.durationSec, maxHeight: this.state(item.path).maxHeight, sourceHeight: item.height });
  }

  /** Độ phân giải cao nhất còn đạt mức sàn ABR (`undefined` = gốc), `null` = không mức nào đạt. Chỉ có nghĩa khi `belowFloor`. */
  protected floorFix(item: PreflightDialogItem): { resolution: number | undefined } | null {
    return resolveAbrFloor({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: this.videoBps(item), maxHeight: this.state(item.path).maxHeight });
  }

  protected applyFloorFix(item: PreflightDialogItem): void {
    const fix = this.floorFix(item);
    if (fix !== null) {
      this.patch(item.path, { maxHeight: fix.resolution });
    }
  }

  protected resolutionOptions(item: PreflightDialogItem): number[] {
    return resolutionChoices(item.height);
  }

  protected qualityOf(item: PreflightDialogItem): { bpp: number; level: QualityLevel; label: string } | null {
    const s = this.state(item.path);
    const videoBps = this.videoBps(item);
    const bpp = reencodeQuality({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: videoBps, maxHeight: s.maxHeight });
    const level = qualityLevel(bpp);
    return bpp === null || level === null ? null : { bpp, level, label: QUALITY_LABEL[level] };
  }

  /** `"1.40-4.20"`: khoảng tức thì; sau "ước tính chính xác" còn lại MỘT số. */
  protected sizeText(item: PreflightDialogItem): string {
    const exact = this.validEstimate(item);
    if (exact) {
      return this.state(item.path).estimate?.extrapolated ? `~${this.gb(exact.estimatedBytes)} GB (dự kiến sau hiệu chỉnh — đo lại để xác nhận)` : `~${this.gb(exact.estimatedBytes)} GB (đã đo)`;
    }
    const plan = this.plan(item);
    const range = estimateReencodeRangeBytes({ targetVideoBitrateBps: plan.targetVideoBitrateBps ?? 0, audioBitrateBps: plan.audioBitrateBps, durationSec: item.durationSec });
    return `~${this.gb(range.minBytes)}–${this.gb(range.maxBytes)} GB`;
  }

  protected timeText(item: PreflightDialogItem): string {
    const exact = this.validEstimate(item);
    if (exact) {
      return `~${Math.max(1, Math.ceil(exact.etaSec / 60))} phút (đã đo, ${exact.speedXRealtime.toFixed(1)}x)`;
    }
    return `~${Math.max(1, Math.ceil(item.durationSec / 60))} phút (ước lượng thô)`;
  }

  protected validEstimate(item: PreflightDialogItem): ReencodeEstimate | null {
    const s = this.state(item.path);
    return s.estimate && s.estimate.planKey === JSON.stringify(this.plan(item)) ? s.estimate.value : null;
  }

  protected estimateStale(item: PreflightDialogItem): boolean {
    const s = this.state(item.path);
    return s.estimate !== null && this.validEstimate(item) === null;
  }

  protected isSuggested(item: PreflightDialogItem, strategy: SizeCapStrategy): boolean {
    return this.suggestions.get(item.path) === strategy;
  }

  protected setStrategy(path: string, strategy: ItemStrategy): void {
    this.patch(path, { strategy });
  }

  protected setSize(path: string, bytes: number): void {
    this.patch(path, { sizeBytes: bytes, targetOverrideBps: null });
  }

  protected setResolution(path: string, value: number | 'source'): void {
    this.patch(path, { maxHeight: value === 'source' ? undefined : value, targetOverrideBps: null });
  }

  protected setAudio(path: string, bps: number): void {
    this.patch(path, { audioBps: bps, targetOverrideBps: null });
  }

  protected resetAuto(item: PreflightDialogItem): void {
    const auto = this.autoState(item);
    this.patch(item.path, { sizeBytes: auto.sizeBytes, maxHeight: auto.maxHeight, audioBps: auto.audioBps, targetOverrideBps: null });
  }

  protected toggleAdvanced(): void {
    const next = !this.advancedOpen();
    this.advancedOpen.set(next);
    void saveUiPrefs({ preflight_advanced_open: next }).catch(() => undefined);
  }

  protected async runEstimate(item: PreflightDialogItem): Promise<void> {
    const plan = this.plan(item);
    const taskId = crypto.randomUUID();
    this.patch(item.path, { estimatingTaskId: taskId, estimateError: null });
    try {
      const samples = await estimateReencode(taskId, item.path, plan);
      const value = estimateFromSamples(samples, item.durationSec);
      if (!value) {
        this.patch(item.path, { estimate: null, estimateError: 'Không đo được (file quá ngắn hoặc lỗi).' });
        return;
      }
      // Tự hiệu chỉnh target theo mẫu đo (ABR bám ±3% sau hiệu chỉnh). So đầu ra đo
      // được với mức video MUỐN đạt (margin 0.955, cố định theo kích thước mục tiêu),
      // KHÔNG so với target hiện tại — nếu không mỗi lần đo lại sẽ hiệu chỉnh chồng và
      // target trôi mãi.
      const target = plan.targetVideoBitrateBps ?? 0;
      const s = this.state(item.path);
      const desiredVideoBitrateBps = computeTargetVideoBitrateBps(s.sizeBytes, item.durationSec, s.audioBps, CALIBRATED_SAFETY_MARGIN);
      const calibrated = calibrateTargetBps({ targetVideoBitrateBps: target, audioBitrateBps: plan.audioBitrateBps, samples, desiredVideoBitrateBps });
      if (calibrated !== null && target > 0 && Math.abs(calibrated / target - 1) > 0.02) {
        this.patch(item.path, { targetOverrideBps: calibrated });
        const estimatedBytes = rescaleEstimateBytes({ estimatedBytes: value.estimatedBytes, durationSec: item.durationSec, fromVideoBps: target, toVideoBps: calibrated, audioBitrateBps: plan.audioBitrateBps });
        this.patch(item.path, { estimate: { planKey: JSON.stringify(this.plan(item)), value: { ...value, estimatedBytes }, extrapolated: true }, estimateError: null });
      } else {
        this.patch(item.path, { estimate: { planKey: JSON.stringify(plan), value, extrapolated: false }, estimateError: null });
      }
    } catch (err) {
      const e = toIngestRpcError(err);
      this.patch(item.path, { estimateError: e.kind === 'Cancelled' ? null : describeIngestError(e) });
    } finally {
      this.patch(item.path, { estimatingTaskId: null });
    }
  }

  protected stopEstimate(path: string): void {
    const taskId = this.state(path).estimatingTaskId;
    if (taskId !== null) {
      void cancelUpload(taskId).catch(() => undefined);
    }
  }

  protected gb(bytes: number): string {
    return (bytes / 1_000_000_000).toFixed(2);
  }

  /** GiB (1024³) — đơn vị Windows Explorer hiện nhưng vẫn ghi nhãn "GB"; các số khác trong dialog là GB thập phân (10⁹). */
  protected gib(bytes: number): string {
    return (bytes / 1_073_741_824).toFixed(2);
  }

  protected kbps(bps: number): string {
    return `${Math.round(bps / 1000)} kbps`;
  }

  protected onConfirm(): void {
    const choices: PreflightChoice[] = [];
    for (const item of this.data.items) {
      const strategy = this.state(item.path).strategy;
      if (strategy === 'reencode') {
        choices.push({ path: item.path, strategy, plan: this.plan(item) });
      } else if (strategy === 'split') {
        choices.push({ path: item.path, strategy });
      }
    }
    this.dialogRef.close({ choices });
  }
}
