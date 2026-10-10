// Trạng thái + logic của dialog tiền kiểm (ADR-0017 § addendum 2026-09-19 "kế hoạch", ADR-0022).
// Một instance cho MỖI lần mở dialog (`providers: [PreflightStore]` ở `PreflightDialog`), chia sẻ
// với hai panel con (nén lại / chia phần) — vỏ dialog và các panel chỉ là template, mọi quyết định
// nằm ở đây hoặc ở hàm thuần của `@tsmc/core-ingest`.
//
// Lý do tuần tự hoá việc nặng của Rust (`enqueue()`): `AppState.active_cancel` chỉ có MỘT slot
// (state.rs), nên hai lệnh quét/đo/ước tính chạy chồng sẽ ghi đè cờ huỷ của nhau — `cancel_upload`
// chỉ dừng được lệnh đứng cuối. Xem trước khung hình thì không dùng slot đó nên chạy tự do.
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  addCut,
  alternativeCuts,
  chooseRateMode,
  defaultRf,
  CRF_PREDICTION_DEVIATION,
  canRemoveCut,
  checkCutMove,
  chooseAutoResolution,
  chooseDefaultStrategy,
  computeTargetVideoBitrateBps,
  crfCeilingBytes,
  estimateFromSamples,
  extrapolateCrfBytes,
  isReencodeFutile,
  nearestKeyframe,
  partFits,
  presetSpeedVsFast,
  planCrf,
  planSplit,
  qualityLevel,
  REENCODE_AUDIO_BITRATE_BPS,
  reencodeQuality,
  removeCut,
  resolutionChoices,
  scaledSize,
  RF_MAX,
  RF_MIN,
  SIZE_SAFETY_MARGIN,
  SPLIT_SAFETY_MARGIN,
  TWO_PASS_SAFETY_MARGIN,
  TWO_PASS_TIME_FACTOR,
  splitPartsFromCuts,
  type CrfPlan,
  type CutMoveCheck,
  type QualityLevel,
  type RateMode,
  type ReencodeEstimate,
  type ReencodePlan,
  type SizeCapStrategy,
  type SplitCandidate,
  type SplitPart,
  type X264Preset
} from '@tsmc/core-ingest';
import { cancelUpload, describeIngestError, estimateReencode, extractPreviewFrame, loadUiPrefs, saveUiPrefs, toIngestRpcError, toPosterDataUri } from '../../../core/ingest-rpc';
import type { IngestRpcErrorDto } from '../../../core/ingest-rpc.types';
import { analyzeAndPlan, describeSplitFailure, scanKeyframes } from '../../../core/split-service';
import { mustReencode, needsDecision, type PreflightChoice, type PreflightDialogData, type PreflightDialogItem } from './preflight-types';

export type ItemStrategy = 'upload' | 'reencode' | 'split' | 'skip';

/** `auto` = thuật toán chọn, user chỉ xem; `manual` = user tự đặt, bắt đầu từ kết quả hiện tại
 * của thuật toán (kể cả target đã hiệu chỉnh sau "Ước tính chính xác"). */
export type CalibrationMode = 'auto' | 'manual';

/** Editor điểm cắt của MỘT file chọn "Chia phần" — quét trên file NGUỒN (chưa remux), nên dung
 * lượng từng phần là xấp xỉ; `processItem()` kiểm lại trên bản remux và rơi về tự động nếu điểm
 * cắt không còn hợp lệ. `playheadSec` (seeker) luôn nằm đúng tại một keyframe và là nguồn DUY NHẤT của khung hình xem trước. */
export interface SplitEditor {
  status: 'idle' | 'loading' | 'ready' | 'error';
  taskId: string | null;
  error: string | null;
  totalBytes: number;
  durationSec: number;
  keyframes: SplitCandidate[];
  autoCuts: SplitCandidate[];
  cuts: SplitCandidate[];
  playheadSec: number;
  /** Điểm cắt đang chọn (index vào `cuts`, −1 = không chọn) — ĐỘC LẬP với playhead: chọn một điểm cắt rồi đưa playhead tới vị trí mới và bấm "Di chuyển điểm cắt đến đây". */
  selectedCut: number;
  /** Đang đo chuyển cảnh/im lặng để chọn điểm cắt tự động. */
  analyzing: boolean;
  /** Đã đo ít nhất một lần: keyframe có `sceneScore`/`silent`, `autoCuts` dùng chúng. */
  analyzed: boolean;
  /** Khung hình tại playhead. Giữ ảnh cũ trong lúc nạp ảnh mới (không nháy trống). */
  preview: { image: string | null; loading: boolean };
}

const IDLE_SPLIT_EDITOR: SplitEditor = {
  status: 'idle',
  taskId: null,
  error: null,
  totalBytes: 0,
  durationSec: 0,
  keyframes: [],
  autoCuts: [],
  cuts: [],
  playheadSec: 0,
  selectedCut: -1,
  analyzing: false,
  analyzed: false,
  preview: { image: null, loading: false }
};

export interface ItemState {
  strategy: ItemStrategy;
  mode: CalibrationMode;
  /** `crf` = chất lượng không đổi + trần VBV vừa trần upload (ADR-0023, mặc định cho Hạng D dưới trần);
   * `abr` = nhắm bitrate/kích thước cụ thể (file vượt trần, hoặc user tự đặt kích thước/bitrate). */
  rateMode: RateMode;
  /** Lý do app tự chuyển sang 2-pass sau "Ước tính chính xác" (chế độ Tự động); xoá khi user đổi tham số. */
  rateNote: string | null;
  /** RF user đặt (chế độ CRF); `null` = mặc định theo chiều cao đầu ra (`defaultRf`). */
  rf: number | null;
  /** Preset x264; `undefined` = mặc định `fast`. */
  preset: X264Preset | undefined;
  /** Lần đo CRF KHÔNG trần gần nhất — gốc để ngoại suy dung lượng/ETA khi kéo thanh RF, đổi preset (nhãn "dự kiến"). */
  crfBasis: { rf: number; bytes: number; speedX: number; preset: X264Preset | undefined } | null;
  /** Kích thước đầu ra mục tiêu (trần cho bitrate). */
  sizeBytes: number;
  /** `undefined` = giữ độ phân giải gốc. */
  maxHeight: number | undefined;
  audioBps: number;
  /** Bitrate video đặt tay HOẶC tự hiệu chỉnh theo mẫu thử (ghi đè công thức từ `sizeBytes`) — xoá khi user đổi kích thước. */
  targetOverrideBps: number | null;
  /** Kết quả "ước tính chính xác" — gắn với plan đã dùng (`planKey`) để biết khi nào hết hiệu lực. `extrapolated`: số dung lượng là ngoại suy sau khi tự hiệu chỉnh target, CHƯA đo lại. */
  estimate: { planKey: string; value: ReencodeEstimate; extrapolated: boolean } | null;
  estimatingTaskId: string | null;
  estimateError: string | null;
  split: SplitEditor;
}

export interface Blocker {
  path: string;
  name: string;
  reason: string;
}

const QUALITY_LABEL: Record<QualityLevel, string> = {
  low: 'thấp — dễ lộ block ở cảnh chuyển động',
  ok: 'trung bình',
  good: 'tốt'
};

/** Hiệu bù khi nạp khung hình: thời điểm keyframe đổi ra giây rồi cắt về µs có thể rơi 1 µs DƯỚI pts
 * thật và seek lùi về keyframe TRƯỚC — cộng nhẹ để luôn trúng đúng keyframe. */
const PREVIEW_SEEK_EPSILON_SEC = 0.002;

@Injectable()
export class PreflightStore {
  readonly data = inject<PreflightDialogData>(MAT_DIALOG_DATA);

  readonly maxGb = (this.data.maxUploadBytes / 1_000_000_000).toFixed(2);
  /** Cận dưới của slider kích thước: 10% trần (dưới đó bitrate chạm sàn). */
  readonly sliderMinBytes = Math.round((this.data.maxUploadBytes * 0.1) / 10_000_000) * 10_000_000;
  readonly sliderStepBytes = 10_000_000;

  private readonly states = signal<ReadonlyMap<string, ItemState>>(new Map(this.data.items.map((i) => [i.path, this.initialState(i)] as const)));
  /** File đang hiện ở panel bên phải: file đầu tiên cần quyết định (hoặc file đầu danh sách). */
  readonly activePath = signal<string>((this.data.items.find((i) => needsDecision(i)) ?? this.data.items[0]).path);

  /** Gợi ý mặc định theo ADR-0017 quyết định #1 — nhãn "Gợi ý" ở thẻ. */
  readonly suggestions = new Map<string, SizeCapStrategy | null>(
    this.data.items.map((i) => [i.path, chooseDefaultStrategy({ sourceBytes: i.sourceBytes, maxUploadBytes: this.data.maxUploadBytes, mustReencode: mustReencode(i) })] as const)
  );

  readonly activeItem = computed(() => this.itemOf(this.activePath()));

  readonly blockers = computed<Blocker[]>(() => {
    const out: Blocker[] = [];
    for (const item of this.data.items) {
      const s = this.state(item.path);
      if (s.strategy === 'reencode') {
        if (s.estimatingTaskId !== null) {
          out.push({ path: item.path, name: item.name, reason: 'đang ước tính' });
        }
        if (this.overCap(item)) {
          out.push({ path: item.path, name: item.name, reason: 'dung lượng dự kiến vượt trần' });
        }
      } else if (s.strategy === 'split') {
        if (s.split.status === 'loading' || s.split.analyzing) {
          out.push({ path: item.path, name: item.name, reason: 'đang quét/đo điểm cắt' });
        } else if (s.split.status === 'error') {
          out.push({ path: item.path, name: item.name, reason: s.split.error ?? 'không chia được' });
        }
      }
    }
    return out;
  });
  readonly reencodeCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'reencode').length);
  readonly splitCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'split').length);
  readonly skipCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'skip').length);
  readonly uploadCount = computed(() => [...this.states().values()].filter((s) => s.strategy === 'upload').length);

  private tail: Promise<unknown> = Promise.resolve();
  private readonly cancelledTasks = new Set<string>();
  private readonly previewBusy = new Set<string>();
  private readonly previewWanted = new Map<string, number>();

  /** Panel "Nâng cao" của chế độ Thủ công mở hay đóng — nhớ ở app-data (`ui_prefs.json`), KHÔNG `localStorage`. */
  readonly advancedOpen = signal(false);

  toggleAdvanced(): void {
    const next = !this.advancedOpen();
    this.advancedOpen.set(next);
    void saveUiPrefs({ preflight_advanced_open: next }).catch(() => undefined);
  }

  constructor() {
    void loadUiPrefs()
      .then((prefs) => this.advancedOpen.set(prefs.preflight_advanced_open))
      .catch(() => undefined);
    inject(DestroyRef).onDestroy(() => {
      // Đóng dialog giữa lúc đang quét/đo/ước tính → dừng ngay, không để Rust chạy tiếp ngầm.
      for (const s of this.states().values()) {
        if (s.estimatingTaskId !== null) {
          this.cancelTask(s.estimatingTaskId);
        }
        if (s.split.taskId !== null) {
          this.cancelTask(s.split.taskId);
        }
      }
    });
    this.activate(this.activePath());
  }

  // ───────────────────────── trạng thái chung ─────────────────────────

  itemOf(path: string): PreflightDialogItem {
    return this.data.items.find((i) => i.path === path) as PreflightDialogItem;
  }

  state(path: string): ItemState {
    return this.states().get(path) as ItemState;
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

  private initialState(item: PreflightDialogItem): ItemState {
    return { ...this.autoState(item), strategy: this.initialStrategy(item) };
  }

  /** Chiến lược chọn sẵn: file không cần quyết định → upload nguyên; Hạng D → nén lại; còn lại theo gợi ý (ADR-0017 #1). */
  private initialStrategy(item: PreflightDialogItem): ItemStrategy {
    if (!needsDecision(item)) {
      return 'upload';
    }
    if (mustReencode(item)) {
      return 'reencode';
    }
    return chooseDefaultStrategy({ sourceBytes: item.sourceBytes, maxUploadBytes: this.data.maxUploadBytes, mustReencode: false }) ?? 'reencode';
  }

  /** Chế độ Tự động. File vượt trần (Option D): ABR, kích thước = trần, độ phân giải = cao nhất còn đạt ngưỡng
   * chất lượng. Hạng D DƯỚI trần (chỉ cần đổi codec): CRF theo bảng HandBrake + trần VBV vừa trần upload — KHÔNG
   * bám bitrate nguồn như thời `h264_mf` (mặc định của nó rất thấp, hình mờ vỡ — đo thật 2026-10-07) mà để x264
   * tự chia bit theo độ khó cảnh (ADR-0023). Thanh kích thước khởi đầu ở trần (= trần VBV). */
  private autoState(item: PreflightDialogItem): ItemState {
    const audioBps = REENCODE_AUDIO_BITRATE_BPS;
    const capVideoBps = computeTargetVideoBitrateBps(this.data.maxUploadBytes, item.durationSec, audioBps, TWO_PASS_SAFETY_MARGIN);
    const sourceLike = !item.overCap;
    return {
      strategy: 'reencode',
      mode: 'auto',
      rateMode: sourceLike ? 'crf' : 'abr',
      rateNote: null,
      rf: null,
      preset: undefined,
      crfBasis: null,
      sizeBytes: this.data.maxUploadBytes,
      maxHeight: sourceLike ? undefined : chooseAutoResolution({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: capVideoBps }),
      audioBps,
      targetOverrideBps: null,
      estimate: null,
      estimatingTaskId: null,
      estimateError: null,
      split: IDLE_SPLIT_EDITOR
    };
  }

  // ───────────────────────── điều hướng / chiến lược / chế độ ─────────────────────────

  /** Chọn file hiện ở panel bên phải; file chia phần chưa quét thì quét ngay (tự động thì đo + chọn luôn). */
  activate(path: string): void {
    this.activePath.set(path);
    this.ensureSplitEditor(path);
  }

  private ensureSplitEditor(path: string): void {
    const s = this.state(path);
    if (s.strategy === 'split' && s.split.status === 'idle') {
      void this.openSplitEditor(this.itemOf(path), s.mode === 'auto');
    }
  }

  setStrategy(path: string, strategy: ItemStrategy): void {
    this.patch(path, { strategy });
    this.ensureSplitEditor(path);
  }

  /** Áp dụng một phương pháp cho mọi file cần quyết định mà phương pháp đó dùng được (thiết lập riêng từng file giữ nguyên). */
  applyStrategyToAll(strategy: Exclude<ItemStrategy, 'upload'>): void {
    for (const item of this.data.items) {
      if (!needsDecision(item) || (strategy === 'split' && !this.canSplit(item))) {
        continue;
      }
      this.setStrategy(item.path, strategy);
    }
  }

  /** Đổi Tự động/Thủ công. Về Tự động = đặt lại theo thuật toán (ghi đè chỉnh tay); sang Thủ công giữ
   * nguyên kết quả hiện tại làm điểm xuất phát. */
  setMode(path: string, mode: CalibrationMode): void {
    if (this.state(path).mode === mode) {
      return;
    }
    this.patch(path, { mode });
    if (mode !== 'auto') {
      return;
    }
    const s = this.state(path);
    if (s.strategy === 'reencode') {
      this.resetEncodeAuto(path);
    } else if (s.strategy === 'split') {
      if (s.split.status === 'ready') {
        this.resetSplitCuts(path);
      } else {
        void this.openSplitEditor(this.itemOf(path), true);
      }
    }
  }

  /** Về Tự động cho MỌI file đang ở Thủ công (ghi đè chỉnh tay — gọi sau khi đã xác nhận). */
  setAllAuto(): void {
    for (const item of this.data.items) {
      this.setMode(item.path, 'auto');
    }
  }

  anyManual(): boolean {
    return [...this.states().values()].some((s) => (s.strategy === 'reencode' || s.strategy === 'split') && s.mode === 'manual');
  }

  canSplit(item: PreflightDialogItem): boolean {
    return !mustReencode(item);
  }

  /** Số phần TỐI THIỂU (chia đều) — thực tế `planSplit()` có thể cần thêm một phần nếu keyframe thưa. */
  splitPartCount(item: PreflightDialogItem): number {
    return Math.max(2, Math.ceil(item.sourceBytes / (this.data.maxUploadBytes * SPLIT_SAFETY_MARGIN)));
  }

  /** Quyết định cho từng file không bị "Bỏ qua". */
  choices(): PreflightChoice[] {
    const out: PreflightChoice[] = [];
    for (const item of this.data.items) {
      const s = this.state(item.path);
      if (s.strategy === 'upload') {
        out.push({ path: item.path, strategy: 'upload' });
      } else if (s.strategy === 'reencode') {
        out.push({ path: item.path, strategy: 'reencode', plan: this.plan(item) });
      } else if (s.strategy === 'split') {
        out.push(s.split.status === 'ready' ? { path: item.path, strategy: 'split', cutTimesSec: s.split.cuts.map((c) => c.timeSec) } : { path: item.path, strategy: 'split' });
      }
    }
    return out;
  }

  // ───────────────────────── việc nặng của Rust, tuần tự ─────────────────────────

  private enqueue<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.cancelledTasks.delete(taskId)) {
        throw { kind: 'Cancelled' } satisfies IngestRpcErrorDto;
      }
      return work();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private cancelTask(taskId: string): void {
    this.cancelledTasks.add(taskId);
    void cancelUpload(taskId).catch(() => undefined);
  }

  // ───────────────────────── nén lại ─────────────────────────

  plan(item: PreflightDialogItem): ReencodePlan {
    const s = this.state(item.path);
    const audioBitrateBps = s.audioBps === REENCODE_AUDIO_BITRATE_BPS ? undefined : s.audioBps;
    const preset = s.preset;
    if (s.rateMode === 'crf') {
      return { crf: this.crfPlan(item), preset, maxHeight: s.maxHeight, audioBitrateBps };
    }
    return { targetVideoBitrateBps: this.videoBps(item), twoPass: true, preset, maxHeight: s.maxHeight, audioBitrateBps };
  }

  /** CRF + trần VBV của file này ở độ phân giải/audio hiện chọn (chỉ có nghĩa khi `rateMode === 'crf'`). */
  crfPlan(item: PreflightDialogItem): CrfPlan {
    const s = this.state(item.path);
    return planCrf({ width: item.width, height: item.height, maxHeight: s.maxHeight, maxUploadBytes: this.data.maxUploadBytes, durationSec: item.durationSec, audioBitrateBps: s.audioBps, rf: s.rf ?? undefined });
  }

  /** Cận trên chắc chắn của dung lượng ở chế độ CRF (= trần VBV). `null` khi không ở chế độ CRF hoặc không biết thời lượng. */
  crfCeiling(item: PreflightDialogItem): number | null {
    const s = this.state(item.path);
    if (s.rateMode !== 'crf') {
      return null;
    }
    const { maxrateBps } = this.crfPlan(item);
    return maxrateBps > 0 ? crfCeilingBytes({ maxrateBps, audioBitrateBps: s.audioBps, durationSec: item.durationSec }) : null;
  }

  /** Bitrate video đang nhắm. Chế độ CRF: đây là TRẦN VBV (x264 thường ra thấp hơn nhiều). */
  videoBps(item: PreflightDialogItem): number {
    const s = this.state(item.path);
    return s.targetOverrideBps ?? computeTargetVideoBitrateBps(s.sizeBytes, item.durationSec, s.audioBps, TWO_PASS_SAFETY_MARGIN);
  }

  videoKbps(item: PreflightDialogItem): number {
    return Math.round(this.videoBps(item) / 1000);
  }

  /** Dung lượng đầu ra ứng với bitrate hiện tại (video + audio) — cho thanh trượt hiện đúng khi user đặt bitrate trực tiếp. */
  effectiveSizeBytes(item: PreflightDialogItem): number {
    const s = this.state(item.path);
    if (s.targetOverrideBps === null) {
      return s.sizeBytes;
    }
    const bytes = ((s.targetOverrideBps + s.audioBps) * item.durationSec) / 8;
    return Math.min(this.data.maxUploadBytes, Math.max(this.sliderMinBytes, bytes));
  }

  setSize(path: string, bytes: number): void {
    this.patch(path, { sizeBytes: bytes, targetOverrideBps: null, rateMode: 'abr', rateNote: null });
  }

  setVideoKbps(path: string, kbps: number): void {
    if (Number.isFinite(kbps) && kbps > 0) {
      this.patch(path, { targetOverrideBps: Math.round(kbps * 1000), rateMode: 'abr', rateNote: null });
    }
  }

  setResolution(path: string, value: number | 'source'): void {
    // Đổi độ phân giải làm mốc đo CRF không còn đại diện → bỏ, chờ đo lại.
    this.patch(path, { maxHeight: value === 'source' ? undefined : value, targetOverrideBps: null, crfBasis: null });
  }

  /** Thanh chất lượng: vị trí trái = nhỏ hơn (RF cao), phải = đẹp hơn (RF thấp). */
  qualitySlider(item: PreflightDialogItem): number {
    return RF_MIN + RF_MAX - this.crfPlan(item).rf;
  }

  /** Kéo thanh chất lượng → chế độ CRF với RF tương ứng (HandBrake "Constant Quality"). */
  setQualitySlider(path: string, position: number): void {
    const rf = Math.min(RF_MAX, Math.max(RF_MIN, Math.round(RF_MIN + RF_MAX - position)));
    this.patch(path, { rf, rateMode: 'crf', rateNote: null, targetOverrideBps: null });
  }

  setPreset(path: string, preset: X264Preset): void {
    this.patch(path, { preset: preset === 'fast' ? undefined : preset });
  }

  /** Chuyển kiểu rate control: `crf` = chất lượng không đổi (thanh RF), `abr` = dung lượng đích (2 lượt). */
  setRateMode(path: string, mode: RateMode): void {
    this.patch(path, { rateMode: mode, rateNote: null, targetOverrideBps: null });
  }

  setAudio(path: string, bps: number): void {
    this.patch(path, { audioBps: bps, targetOverrideBps: null });
  }

  resetEncodeAuto(path: string): void {
    const auto = this.autoState(this.itemOf(path));
    this.patch(path, { sizeBytes: auto.sizeBytes, maxHeight: auto.maxHeight, audioBps: auto.audioBps, targetOverrideBps: null, rateMode: auto.rateMode, rateNote: null, rf: null, preset: undefined, crfBasis: null });
  }

  /** Dung lượng đã đo/dự kiến (sau "Ước tính chính xác") vượt trần upload. Chưa đo thì không biết → `false`. */
  overCap(item: PreflightDialogItem): boolean {
    const exact = this.validEstimate(item);
    return exact !== null && exact.estimatedBytes > this.data.maxUploadBytes;
  }

  /** Nén lại gần như không giảm gì so với nguồn (target ≥ ~90% bitrate video nguồn). */
  futile(item: PreflightDialogItem): boolean {
    // Hạng D phải mã hoá lại để trình duyệt phát được dù bitrate không giảm — "vô nghĩa" không áp dụng.
    return this.state(item.path).rateMode === 'abr' && !mustReencode(item) && isReencodeFutile({ targetVideoBitrateBps: this.videoBps(item), sourceBytes: item.sourceBytes, durationSec: item.durationSec, maxHeight: this.state(item.path).maxHeight, sourceHeight: item.height });
  }

  resolutionOptions(item: PreflightDialogItem): number[] {
    return resolutionChoices(item.height);
  }

  /** RF mặc định của file này ở độ phân giải đầu ra hiện chọn (bảng "Fast" của HandBrake). */
  defaultRfFor(item: PreflightDialogItem): number {
    return defaultRf(scaledSize(item.width, item.height, this.state(item.path).maxHeight).height);
  }

  /** Nhãn chữ cho RF — chỉ để đọc nhanh, ranh giới theo bảng RF của HandBrake (20–22 là vùng "Fast" chuẩn). */
  rfLabel(rf: number): string {
    if (rf <= 19) {
      return 'rất cao';
    }
    if (rf <= 21) {
      return 'cao';
    }
    if (rf <= 23) {
      return 'chuẩn';
    }
    return rf <= 26 ? 'gọn' : 'nhỏ';
  }

  /** Mô tả chế độ CRF cho panel: RF đang dùng và trần bitrate VBV (kbps). `null` ngoài chế độ CRF. */
  crfInfo(item: PreflightDialogItem): { rf: number; maxrateKbps: number } | null {
    if (this.state(item.path).rateMode !== 'crf') {
      return null;
    }
    const { rf, maxrateBps } = this.crfPlan(item);
    return { rf, maxrateKbps: Math.round(maxrateBps / 1000) };
  }

  qualityOf(item: PreflightDialogItem): { bpp: number; level: QualityLevel; label: string } | null {
    const s = this.state(item.path);
    if (s.rateMode === 'crf') {
      return null; // bits/pixel của TRẦN không nói gì về chất lượng CRF — dùng crfInfo()
    }
    const bpp = reencodeQuality({ width: item.width, height: item.height, fps: item.fps, videoBitrateBps: this.videoBps(item), maxHeight: s.maxHeight });
    const level = qualityLevel(bpp);
    return bpp === null || level === null ? null : { bpp, level, label: QUALITY_LABEL[level] };
  }

  /** `"1.40-4.20 GB"`: khoảng tức thì; sau "ước tính chính xác" còn lại MỘT số; chưa đặt bitrate thì bộ nén tự quyết. */
  sizeText(item: PreflightDialogItem): string {
    const s = this.state(item.path);
    const exact = this.validEstimate(item);
    if (exact) {
      return s.estimate?.extrapolated ? `~${this.gb(exact.estimatedBytes)} GB (dự kiến sau hiệu chỉnh — đo lại để xác nhận)` : `~${this.gb(exact.estimatedBytes)} GB (đã đo)`;
    }
    const plan0 = this.plan(item);
    if (plan0.twoPass && plan0.targetVideoBitrateBps) {
      const bytes = crfCeilingBytes({ maxrateBps: plan0.targetVideoBitrateBps, audioBitrateBps: plan0.audioBitrateBps, durationSec: item.durationSec });
      return `~${this.gb(bytes)} GB (nén 2 lượt theo dung lượng đích, sai số ~2%)`;
    }
    const predicted = this.crfPredictedBytes(item);
    if (predicted !== null) {
      return `~${this.gb(predicted)} GB (dự kiến theo RF từ lần đo — "Đo lại" để xác nhận)`;
    }
    const ceiling = this.crfCeiling(item);
    if (ceiling !== null) {
      return `tối đa ~${this.gb(ceiling)} GB (trần theo dung lượng cho phép — bấm "Ước tính chính xác" để biết số thật)`;
    }
    // Đến đây = chế độ CRF mà không biết thời lượng (không có trần VBV để tính cận trên) — chỉ đo mẫu mới biết.
    return 'chưa biết — bấm "Ước tính chính xác"';
  }

  timeText(item: PreflightDialogItem): string {
    const exact = this.validEstimate(item);
    if (exact) {
      return `~${Math.max(1, Math.ceil(exact.etaSec / 60))} phút (đã đo, ${exact.speedXRealtime.toFixed(1)}x)`;
    }
    const basis = this.state(item.path).crfBasis;
    if (basis && this.state(item.path).rateMode === 'crf' && basis.speedX > 0) {
      const speed = basis.speedX * (presetSpeedVsFast(this.state(item.path).preset) / presetSpeedVsFast(basis.preset));
      return `~${Math.max(1, Math.ceil(item.durationSec / speed / 60))} phút (dự kiến theo tốc độ đo, ${speed.toFixed(1)}x)`;
    }
    return `~${Math.max(1, Math.ceil(item.durationSec / 60))} phút (ước lượng thô)`;
  }

  /** Dung lượng CRF KHÔNG trần dự kiến ở RF hiện tại, ngoại suy từ lần đo gần nhất. `null` nếu chưa đo/không ở CRF. */
  crfPredictedBytes(item: PreflightDialogItem): number | null {
    const s = this.state(item.path);
    if (s.rateMode !== 'crf' || !s.crfBasis) {
      return null;
    }
    return extrapolateCrfBytes({
      basisBytes: s.crfBasis.bytes,
      basisRf: s.crfBasis.rf,
      rf: this.crfPlan(item).rf,
      durationSec: item.durationSec,
      audioBitrateBps: s.audioBps,
      ceilingBytes: this.crfCeiling(item) ?? undefined
    });
  }

  /** RF hiện tại dự kiến ra lớn hơn ngân sách (sau độ lệch dự đoán) — trần VBV sẽ ép hình; gợi ý đổi cách. */
  crfExceedsBudget(item: PreflightDialogItem): boolean {
    const s = this.state(item.path);
    if (s.rateMode !== 'crf' || !s.crfBasis) {
      return false;
    }
    const uncapped = extrapolateCrfBytes({ basisBytes: s.crfBasis.bytes, basisRf: s.crfBasis.rf, rf: this.crfPlan(item).rf, durationSec: item.durationSec, audioBitrateBps: s.audioBps });
    return chooseRateMode({ predictedBytes: uncapped, maxUploadBytes: this.data.maxUploadBytes }) === 'abr';
  }

  validEstimate(item: PreflightDialogItem): ReencodeEstimate | null {
    const s = this.state(item.path);
    return s.estimate && s.estimate.planKey === JSON.stringify(this.plan(item)) ? s.estimate.value : null;
  }

  estimateStale(item: PreflightDialogItem): boolean {
    const s = this.state(item.path);
    // Chế độ CRF có mốc đo: kéo RF/đổi preset cho ra số "dự kiến" ở sizeText/timeText, không cần nhắc "kết quả cũ".
    if (s.rateMode === 'crf' && s.crfBasis !== null) {
      return false;
    }
    return s.estimate !== null && this.validEstimate(item) === null;
  }

  isSuggested(item: PreflightDialogItem, strategy: SizeCapStrategy): boolean {
    return this.suggestions.get(item.path) === strategy;
  }

  async runEstimate(item: PreflightDialogItem): Promise<void> {
    const plan = this.plan(item);
    // Chế độ CRF: đo KHÔNG trần VBV — số cần biết là dung lượng ở RF đã chọn (để chọn CRF hay 2-pass), mà mẫu
    // bị trần chặn luôn ra đúng trần (xem ADR-0023 § 4c.2).
    const estimatePlan: ReencodePlan = plan.crf ? { ...plan, crf: { ...plan.crf, maxrateBps: 0, bufsizeBits: 0 } } : plan;
    const taskId = crypto.randomUUID();
    this.patch(item.path, { estimatingTaskId: taskId, estimateError: null });
    try {
      const samples = await this.enqueue(taskId, () => estimateReencode(taskId, item.path, estimatePlan));
      const value = estimateFromSamples(samples, item.durationSec);
      if (!value) {
        this.patch(item.path, { estimate: null, estimateError: 'Không đo được (file quá ngắn hoặc lỗi).' });
        return;
      }
      if (plan.crf) {
        this.applyCrfEstimate(item, plan, value);
        return;
      }
      // 2-pass bám đích ±2% theo thiết kế nên dung lượng = đích, KHÔNG lấy từ mẫu: mẫu 8 s dưới `bufsize` 4× target
      // cho phép vọt đỉnh đầu đoạn (đo 2026-10-10: mẫu ra ~2050 kbps cho đích 1610 kbps tổng) — số đó không mang
      // sang cả file được. Mẫu chạy đủ hai lượt nên `speedXRealtime` là tốc độ của CẢ HAI lượt; còn thiên lệch
      // chậm vì chi phí mở decoder/encoder mỗi đoạn (ETA thật thường nhanh hơn ~30%).
      const nominalBytes = crfCeilingBytes({ maxrateBps: plan.targetVideoBitrateBps ?? 0, audioBitrateBps: plan.audioBitrateBps, durationSec: item.durationSec });
      this.patch(item.path, { estimate: { planKey: JSON.stringify(plan), value: { ...value, estimatedBytes: nominalBytes }, extrapolated: false }, estimateError: null });
    } catch (err) {
      const e = toIngestRpcError(err);
      this.patch(item.path, { estimateError: e.kind === 'Cancelled' ? null : describeIngestError(e) });
    } finally {
      this.patch(item.path, { estimatingTaskId: null });
    }
  }

  /** Kết quả mẫu CRF không trần → chọn CRF hay 2-pass (`chooseRateMode`). Chế độ Tự động tự chuyển sang
   * 2-pass kèm lý do; Thủ công giữ CRF (VBV vẫn chặn trần) và chỉ báo dự đoán vượt ngân sách. */
  private applyCrfEstimate(item: PreflightDialogItem, plan: ReencodePlan, measured: ReencodeEstimate): void {
    const s = this.state(item.path);
    const decision = chooseRateMode({ predictedBytes: measured.estimatedBytes, maxUploadBytes: this.data.maxUploadBytes });
    const crfBasis = { rf: plan.crf?.rf ?? 0, bytes: measured.estimatedBytes, speedX: measured.speedXRealtime, preset: plan.preset };
    if (decision === 'crf' || s.mode !== 'auto') {
      this.patch(item.path, { estimate: { planKey: JSON.stringify(plan), value: measured, extrapolated: false }, crfBasis, rateNote: null, estimateError: null });
      return;
    }
    const rf = plan.crf?.rf ?? 0;
    this.patch(item.path, {
      rateMode: 'abr',
      crfBasis,
      targetOverrideBps: null,
      rateNote: `Ở RF ${rf} dự đoán ~${this.gb(measured.estimatedBytes)} GB (có thể lệch tới ${Math.round((CRF_PREDICTION_DEVIATION - 1) * 100)}%) — gần/vượt ngân sách ${this.gb(this.data.maxUploadBytes * SIZE_SAFETY_MARGIN)} GB nên nén 2 lượt theo dung lượng đích để không bị trần ép hình.`,
      estimateError: null
    });
    // Số cho kế hoạch MỚI là ngoại suy (dung lượng ≈ đích, tốc độ = tốc độ 1 lượt / hệ số 2 lượt) — gắn
    // `extrapolated` để UI ghi "dự kiến", user bấm "Đo lại" để đo thật bằng mẫu 2 lượt.
    const next = this.plan(item);
    const speed = measured.speedXRealtime / TWO_PASS_TIME_FACTOR;
    const estimatedBytes = crfCeilingBytes({ maxrateBps: next.targetVideoBitrateBps ?? 0, audioBitrateBps: next.audioBitrateBps, durationSec: item.durationSec });
    this.patch(item.path, {
      estimate: { planKey: JSON.stringify(next), value: { estimatedBytes, speedXRealtime: speed, etaSec: item.durationSec / speed }, extrapolated: true }
    });
  }

  stopEstimate(path: string): void {
    const taskId = this.state(path).estimatingTaskId;
    if (taskId !== null) {
      this.cancelTask(taskId);
    }
  }

  // ───────────────────────── chia phần ─────────────────────────

  private patchSplit(path: string, change: Partial<SplitEditor>): void {
    this.patch(path, { split: { ...this.state(path).split, ...change } });
  }

  /** Quét keyframe của file nguồn rồi chia đều theo byte (chỉnh được ngay); `autoAnalyze` thì đo luôn chuyển cảnh/im lặng và chọn điểm cắt tự động. */
  async openSplitEditor(item: PreflightDialogItem, autoAnalyze = false): Promise<void> {
    const taskId = crypto.randomUUID();
    this.patchSplit(item.path, { ...IDLE_SPLIT_EDITOR, status: 'loading', taskId });
    try {
      const { scan, keyframes } = await this.enqueue(taskId, () => scanKeyframes(taskId, item.path));
      const plan = planSplit({ keyframes, totalBytes: scan.total_packet_bytes, durationSec: scan.duration_sec, maxUploadBytes: this.data.maxUploadBytes });
      if (!plan.ok) {
        this.patchSplit(item.path, { status: 'error', taskId: null, error: describeSplitFailure(plan.reason, item.sourceBytes, this.data.maxUploadBytes) });
        return;
      }
      this.patchSplit(item.path, { status: 'ready', taskId: null, totalBytes: scan.total_packet_bytes, durationSec: scan.duration_sec, keyframes, autoCuts: plan.cuts, cuts: plan.cuts, playheadSec: plan.cuts[0].timeSec, selectedCut: 0 });
      this.loadPreview(item.path);
      if (autoAnalyze) {
        await this.analyzeSplit(item);
      }
    } catch (err) {
      const e = toIngestRpcError(err);
      this.patchSplit(item.path, e.kind === 'Cancelled' ? { ...IDLE_SPLIT_EDITOR } : { status: 'error', taskId: null, error: describeIngestError(e) });
    }
  }

  /** Đo chuyển cảnh/im lặng quanh mốc chia đều rồi ĐẶT điểm cắt tự động (ghi đè các điểm cắt hiện tại). */
  async analyzeSplit(item: PreflightDialogItem): Promise<void> {
    const sp = this.state(item.path).split;
    if (sp.status !== 'ready' || sp.analyzing) {
      return;
    }
    const taskId = crypto.randomUUID();
    this.patchSplit(item.path, { analyzing: true, taskId });
    try {
      const { keyframes, plan } = await this.enqueue(taskId, () => analyzeAndPlan(taskId, item.path, { keyframes: sp.keyframes, totalBytes: sp.totalBytes, durationSec: sp.durationSec }, this.data.maxUploadBytes));
      if (!plan.ok) {
        this.patchSplit(item.path, { analyzing: false, taskId: null, keyframes, analyzed: true });
        return;
      }
      this.patchSplit(item.path, { analyzing: false, taskId: null, analyzed: true, keyframes, autoCuts: plan.cuts, cuts: plan.cuts, playheadSec: plan.cuts[0].timeSec, selectedCut: 0 });
      this.loadPreview(item.path);
    } catch (err) {
      const e = toIngestRpcError(err);
      this.patchSplit(item.path, { analyzing: false, taskId: null });
      if (e.kind !== 'Cancelled') {
        this.patchSplit(item.path, { error: describeIngestError(e) });
      }
    }
  }

  stopSplitEditor(path: string): void {
    const taskId = this.state(path).split.taskId;
    if (taskId !== null) {
      this.cancelTask(taskId);
    }
  }

  /** Về kết quả của THUẬT TOÁN: chưa đo thì đo rồi chọn; đã đo thì đặt lại về lần chọn đó. */
  resetSplitCuts(path: string): void {
    const sp = this.state(path).split;
    if (!sp.analyzed) {
      void this.analyzeSplit(this.itemOf(path));
      return;
    }
    this.patchSplit(path, { cuts: sp.autoCuts, playheadSec: sp.autoCuts[0].timeSec, selectedCut: 0 });
    this.loadPreview(path);
  }

  splitParts(path: string): SplitPart[] {
    const sp = this.state(path).split;
    return splitPartsFromCuts(sp.cuts, sp.totalBytes, sp.durationSec);
  }

  partOk(part: SplitPart): boolean {
    return partFits(part, this.data.maxUploadBytes);
  }

  splitEdited(path: string): boolean {
    const sp = this.state(path).split;
    return sp.cuts.length !== sp.autoCuts.length || sp.cuts.some((c, i) => c.timeSec !== sp.autoCuts[i]?.timeSec);
  }

  /** Điểm cắt đang chọn (−1 = không chọn). */
  selectedCut(path: string): number {
    return this.state(path).split.selectedCut;
  }

  /** Chọn điểm cắt `index` và đưa seeker tới đó (để thấy khung hình tại chỗ cắt hiện tại). */
  selectCut(path: string, index: number): void {
    const sp = this.state(path).split;
    const cut = sp.cuts[index];
    if (!cut) {
      return;
    }
    this.patchSplit(path, { selectedCut: index });
    this.setPlayhead(path, cut.timeSec);
  }

  /** Các keyframe thay thế được cho điểm cắt `index` mà mọi phần vẫn vừa trần. */
  splitAlternatives(path: string, index: number): SplitCandidate[] {
    const sp = this.state(path).split;
    return alternativeCuts({ keyframes: sp.keyframes, cuts: sp.cuts, index, totalBytes: sp.totalBytes, maxUploadBytes: this.data.maxUploadBytes });
  }

  /** Đặt playhead về keyframe gần `timeSec` nhất và nạp khung hình tại đó. */
  setPlayhead(path: string, timeSec: number): void {
    const sp = this.state(path).split;
    const k = nearestKeyframe(sp.keyframes, timeSec);
    if (k && k.timeSec !== sp.playheadSec) {
      this.patchSplit(path, { playheadSec: k.timeSec });
      this.loadPreview(path);
    }
  }

  /** Playhead nhích `delta` keyframe (‹ ›). */
  stepPlayhead(path: string, delta: number): void {
    const sp = this.state(path).split;
    const i = sp.keyframes.findIndex((k) => k.timeSec === sp.playheadSec);
    const target = sp.keyframes[(i < 0 ? 0 : i) + delta];
    if (target) {
      this.setPlayhead(path, target.timeSec);
    }
  }

  /** Keyframe đang ở seeker. */
  private playheadKeyframe(path: string): SplitCandidate | undefined {
    const sp = this.state(path).split;
    return sp.keyframes.find((k) => k.timeSec === sp.playheadSec);
  }

  /** Dời điểm cắt đang chọn tới seeker có hợp lệ không — `null` nếu không chọn điểm cắt nào. */
  cutMoveCheck(path: string): CutMoveCheck | null {
    const sp = this.state(path).split;
    const candidate = this.playheadKeyframe(path);
    if (sp.selectedCut < 0 || !candidate) {
      return null;
    }
    return checkCutMove({ cuts: sp.cuts, index: sp.selectedCut, candidate, totalBytes: sp.totalBytes, durationSec: sp.durationSec, maxUploadBytes: this.data.maxUploadBytes });
  }

  /** "Di chuyển điểm cắt N đến đây": đặt điểm cắt đang chọn vào keyframe ở seeker (chỉ khi hợp lệ). */
  moveSelectedCutToPlayhead(path: string): void {
    const sp = this.state(path).split;
    const candidate = this.playheadKeyframe(path);
    if (candidate && this.cutMoveCheck(path)?.ok) {
      this.patchSplit(path, { cuts: sp.cuts.map((c, i) => (i === sp.selectedCut ? candidate : c)) });
    }
  }

  /** Thêm điểm cắt tại playhead (một keyframe) — chia một phần thành hai. */
  canAddCutAtPlayhead(path: string): boolean {
    const sp = this.state(path).split;
    const k = sp.keyframes.find((c) => c.timeSec === sp.playheadSec);
    return k !== undefined && addCut(sp.cuts, k) !== null;
  }

  addCutAtPlayhead(path: string): void {
    const sp = this.state(path).split;
    const k = sp.keyframes.find((c) => c.timeSec === sp.playheadSec);
    const next = k ? addCut(sp.cuts, k) : null;
    if (next && k) {
      this.patchSplit(path, { cuts: next, selectedCut: next.findIndex((c) => c.timeSec === k.timeSec) });
    }
  }

  /** Bỏ điểm cắt đang chọn (gộp hai phần kề) — chỉ khi phần gộp vẫn vừa trần. */
  canRemoveSelectedCut(path: string): boolean {
    const sp = this.state(path).split;
    return canRemoveCut({ cuts: sp.cuts, index: sp.selectedCut, totalBytes: sp.totalBytes, durationSec: sp.durationSec, maxUploadBytes: this.data.maxUploadBytes });
  }

  removeSelectedCut(path: string): void {
    const sp = this.state(path).split;
    if (sp.selectedCut >= 0 && this.canRemoveSelectedCut(path)) {
      this.patchSplit(path, { cuts: removeCut(sp.cuts, sp.selectedCut), selectedCut: -1 });
    }
  }

  /** Nạp khung hình tại playhead: mỗi lúc chỉ MỘT lệnh Rust bay, yêu cầu mới đè yêu cầu đang chờ (kéo nhanh không dồn hàng đợi). */
  private loadPreview(path: string): void {
    this.previewWanted.set(path, this.state(path).split.playheadSec);
    if (!this.previewBusy.has(path)) {
      void this.pumpPreview(path);
    }
  }

  private async pumpPreview(path: string): Promise<void> {
    this.previewBusy.add(path);
    try {
      for (let wanted = this.previewWanted.get(path); wanted !== undefined; wanted = this.previewWanted.get(path)) {
        this.previewWanted.delete(path);
        this.patchSplit(path, { preview: { ...this.state(path).split.preview, loading: true } });
        try {
          const base64 = await extractPreviewFrame(path, wanted + PREVIEW_SEEK_EPSILON_SEC);
          if (!this.previewWanted.has(path)) {
            this.patchSplit(path, { preview: { image: toPosterDataUri(base64), loading: false } });
          }
        } catch {
          // Không có ảnh xem trước không chặn việc chọn điểm cắt — giữ ảnh cũ.
        }
      }
    } finally {
      this.previewBusy.delete(path);
      this.patchSplit(path, { preview: { ...this.state(path).split.preview, loading: false } });
    }
  }

  // ───────────────────────── tiện ích hiển thị ─────────────────────────

  gb(bytes: number): string {
    return (bytes / 1_000_000_000).toFixed(2);
  }

  /** GiB (1024³) — đơn vị Windows Explorer hiện nhưng vẫn ghi nhãn "GB"; các số khác là GB thập phân (10⁹). */
  gib(bytes: number): string {
    return (bytes / 1_073_741_824).toFixed(2);
  }

  kbps(bps: number): string {
    return `${Math.round(bps / 1000)} kbps`;
  }

  /** Nhãn tag cho một điểm cắt/keyframe theo tín hiệu đã đo. */
  cutTags(cut: SplitCandidate): string[] {
    const tags: string[] = [];
    if ((cut.sceneScore ?? 0) >= 0.5) {
      tags.push('chuyển cảnh');
    }
    if (cut.silent) {
      tags.push('im lặng');
    }
    return tags;
  }
}
