import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatStepperModule } from '@angular/material/stepper';
import { Router } from '@angular/router';
import {
  checkSession,
  describeIngestError,
  loadSavedCredentials,
  requestLoginCode,
  saveCredentials,
  submitOtp,
  submitPassword,
  toIngestRpcError
} from '../core/ingest-rpc';
import { COUNTRY_DIAL_CODES, toE164 } from './country-codes';

type LoginStatus = 'checking' | 'form' | 'code' | 'password' | 'done';

const API_ID_PATTERN = /^\d+$/;
const API_HASH_PATTERN = /^[0-9a-fA-F]{32}$/;

/**
 * Màn đăng nhập của tsmc-ingest-desktop (docs/ux-design.md § Phụ lục A.4,
 * hàng "Đăng nhập"). Vertical `MatStepper` 2-3 bước, cùng hình dạng với
 * apps/web/src/app/login/login.ts (F1.1) để giữ nhất quán sản phẩm, nhưng
 * lái bằng 5 Tauri command của `src-tauri/src/commands.rs` qua `core/
 * ingest-rpc.ts` thay vì TelegramGateway/Core Worker — hai app hoàn toàn
 * tách biệt runtime MTProto (ADR-0017).
 *
 * `[linear]="false"` + `[editable]="false"` từng step: KHÔNG dùng cơ chế
 * "linear" gốc của CdkStepper — race điều kiện thật khi lái selectedIndex/
 * completed bằng binding qua signal (ADR-0016 addendum 2026-08-27, đã tái
 * hiện ở chính apps/web).
 *
 * `tryAutoLogin()` (thêm 2026-09-10, đổi nguồn credential 2026-09-11): tự
 * `check_session()` ngay trong constructor bằng credential đã nhớ — KHÔNG
 * gõ gì cả nếu session còn hợp lệ. Nhớ ở APP-DATA (Rust, `credentials.json`
 * cạnh `session.sqlite3`), KHÔNG PHẢI `localStorage` — `localStorage` tách
 * theo ORIGIN phục vụ webview, `cargo tauri dev` (`http://localhost:4300`)
 * và bản release (protocol riêng của Tauri) là hai origin khác nhau, không
 * chia sẻ gì cả. Phát hiện thật 2026-09-11: bản đầu chỉ nhớ ở `localStorage`
 * khiến đổi qua lại giữa hai cách chạy bắt gõ lại form dù đã đăng nhập ở
 * cách kia — đúng kiểu bug "thiết kế vô lý" (mỗi lần mở phải gõ lại 3 ô) mà
 * `app_data_dir()` (không phụ thuộc origin) giải quyết dứt điểm.
 *
 * `goToDone()` (thêm slice Chọn kênh) điều hướng thẳng sang `/channel` thay
 * vì dừng ở panel "đã đăng nhập" tĩnh — màn đó giờ đã có route thật.
 *
 * `scheduleAutoCheck()`/`onApiIdInput()`: lớp phòng thủ cho trường hợp CHƯA
 * từng lưu `credentials.json` (lần đầu thật sự, hoặc file bị xoá) — gõ xong
 * API_ID hợp lệ tự gọi ngầm `check_session()`, không cần đợi API_HASH/số
 * điện thoại/nút "Tiếp tục". **Nhánh này TỰ LƯU credentials luôn khi thành
 * công** (`runAutoCheck()`, vá 2026-09-11 sau bug thật) — thiếu bước này thì
 * user luôn đăng nhập lại qua đúng nhánh nhanh này (không cần bịa API_HASH/
 * số điện thoại như nhánh "Tiếp tục" đầy đủ), `credentials.json` không bao
 * giờ được tạo, và `tryAutoLogin()` không bao giờ có gì để đọc — vòng lặp
 * "mở app vẫn phải gõ API_ID" lặp lại vô tận dù NHÌN NHƯ đã đăng nhập được.
 */
@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatStepperModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Login {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly countryDialCodes = COUNTRY_DIAL_CODES;
  protected readonly defaultDialCode = COUNTRY_DIAL_CODES[0].dialCode;

  protected readonly status = signal<LoginStatus>('checking');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly floodWaitRemaining = signal<number | null>(null);

  // Credential đã nhớ từ lần trước (nếu có, đọc từ app-data qua
  // loadSavedCredentials()) — chỉ dùng để set giá trị ban đầu cho input
  // (template ref, không phải reactive form) lúc chuyển từ 'checking' sang
  // 'form'. Rỗng nếu chưa từng đăng nhập trên máy này (hoặc chưa từng chạy
  // hết một lần submit đầy đủ — xem tryAutoLogin()).
  protected readonly savedApiIdPrefill = signal('');
  protected readonly savedApiHashPrefill = signal('');
  protected readonly dialCodePrefill = signal(this.defaultDialCode);
  protected readonly savedNationalNumberPrefill = signal('');

  // Giá trị sống của API_ID/API_HASH — CHỈ để tính credentialsValid (khoá/mở
  // nhãn Bước 2), KHÔNG dùng để submit (submit đọc thẳng từ template ref).
  private readonly apiIdLive = signal('');
  private readonly apiHashLive = signal('');
  protected readonly credentialsValid = computed(
    () => API_ID_PATTERN.test(this.apiIdLive().trim()) && API_HASH_PATTERN.test(this.apiHashLive().trim())
  );

  protected readonly stepIndex = computed(() => {
    switch (this.status()) {
      case 'code':
        return 1;
      case 'password':
      case 'done':
        return 2;
      default:
        return 0;
    }
  });

  // api_id của lần check_session() thành công gần nhất — cần để dựng lại
  // state Connected phía Rust khi submit_otp/submit_password sai (xem
  // resetAfterAuthFailure()), KHÔNG đọc lại từ input vì user có thể đã gõ
  // tiếp giá trị khác trong lúc chờ submit.
  private lastApiId: number | null = null;
  private floodWaitTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly autoChecking = signal(false);
  private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
  // Tăng mỗi lần lên lịch check mới — kết quả trả về từ một lần gõ CŨ (user
  // đã gõ tiếp giá trị khác, hoặc đã bấm "Tiếp tục" thủ công) bị bỏ qua,
  // tránh ghi đè trạng thái bằng một response chậm/trễ.
  private autoCheckToken = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearFloodWaitTimer();
      this.clearAutoCheckTimer();
    });
    void this.tryAutoLogin();
  }

  /** Lúc mở app: nếu máy này từng đăng nhập (có credential nhớ ở app-data),
   * tự gọi `check_session()` một lần — thành công thì nhảy thẳng 'done',
   * KHÔNG bắt user gõ gì cả. Không có gì nhớ, hoặc check_session() lỗi
   * (session chết/hết hạn) → coi như chưa đăng nhập, prefill lại form bằng
   * đúng những gì đã nhớ (đỡ gõ lại từ đầu) thay vì hiện lỗi ngay — cùng
   * tinh thần `restore()` của apps/web/src/app/login/login.ts. */
  private async tryAutoLogin(): Promise<void> {
    const saved = await this.loadSaved();
    if (saved === null) {
      this.status.set('form');
      return;
    }
    try {
      const authorized = await checkSession(saved.api_id);
      this.lastApiId = saved.api_id;
      if (authorized) {
        this.goToDone();
        return;
      }
    } catch {
      // Session cũ lỗi/hết hạn — không chặn onboarding, coi như chưa đăng
      // nhập, không phải lỗi cần hiển thị ngay.
    }
    this.savedApiIdPrefill.set(String(saved.api_id));
    this.savedApiHashPrefill.set(saved.api_hash);
    this.dialCodePrefill.set(saved.dial_code || this.defaultDialCode);
    this.savedNationalNumberPrefill.set(saved.national_number);
    this.apiIdLive.set(String(saved.api_id));
    this.apiHashLive.set(saved.api_hash);
    this.status.set('form');
  }

  private async loadSaved(): Promise<{ api_id: number; api_hash: string; dial_code: string; national_number: string } | null> {
    try {
      return await loadSavedCredentials();
    } catch {
      // Lỗi IPC (hiếm) — coi như chưa có gì nhớ, không chặn onboarding.
      return null;
    }
  }

  private async persistCredentials(apiId: number, apiHash: string, dialCode: string, nationalNumber: string): Promise<void> {
    try {
      await saveCredentials(apiId, apiHash, dialCode, nationalNumber);
    } catch {
      // Không critical — chỉ mất tiện nghi tự điền/tự nhận ra lần sau.
    }
  }

  private goToDone(): void {
    this.status.set('done');
    void this.router.navigateByUrl('/channel');
  }

  protected onApiIdInput(value: string): void {
    this.apiIdLive.set(value);
    this.scheduleAutoCheck(value);
  }

  /** Debounce 500ms sau khi gõ xong API_ID — đủ để không gọi RPC trên từng
   * ký tự gõ, đủ nhanh để cảm giác "tự nhận ra". Không cần API_HASH/số điện
   * thoại vì `check_session()` không dùng tới (xem doc comment đầu file). */
  private scheduleAutoCheck(rawValue: string): void {
    this.clearAutoCheckTimer();
    const trimmed = rawValue.trim();
    if (!API_ID_PATTERN.test(trimmed) || this.status() !== 'form' || this.submitting()) {
      return;
    }
    const apiId = Number(trimmed);
    const token = ++this.autoCheckToken;
    this.autoCheckTimer = setTimeout(() => void this.runAutoCheck(apiId, token), 500);
  }

  private async runAutoCheck(apiId: number, token: number): Promise<void> {
    this.autoChecking.set(true);
    try {
      const authorized = await checkSession(apiId);
      // Bỏ qua nếu đã có lần gõ mới hơn, hoặc user đã bấm "Tiếp tục" thủ
      // công song song trong lúc chờ — token khác nghĩa là kết quả này trễ.
      if (token !== this.autoCheckToken || this.status() !== 'form') {
        return;
      }
      this.lastApiId = apiId;
      if (authorized) {
        // Bug thật đã gặp (2026-09-11): KHÔNG gọi persistCredentials() ở đây
        // (bản trước) khiến `credentials.json` không bao giờ được tạo nếu
        // user luôn đăng nhập lại qua đúng nhánh debounce này (nhanh hơn hẳn
        // so với phải bịa API_HASH/số điện thoại để bấm "Tiếp tục") — vòng
        // lặp vô tận "mở app vẫn phải gõ API_ID". check_session() chỉ cần
        // api_id nên VẪN AN TOÀN để lưu ở đây dù chưa có hash/phone — tái
        // dùng giá trị đã nhớ trước đó (rỗng nếu chưa từng có), không ghi đè
        // bằng chuỗi rỗng nếu vô tình có sẵn giá trị thật từ một lần load
        // trước.
        await this.persistCredentials(apiId, this.savedApiHashPrefill(), this.dialCodePrefill(), this.savedNationalNumberPrefill());
        this.goToDone();
      }
    } catch {
      // Session không hợp lệ với api_id này (chưa từng đăng nhập trên máy
      // này, hoặc gõ nhầm) — im lặng, để user tự gõ tiếp API_HASH/số điện
      // thoại nếu thật sự cần đăng nhập mới, không chặn bằng lỗi ngay lúc gõ.
    } finally {
      if (token === this.autoCheckToken) {
        this.autoChecking.set(false);
      }
    }
  }

  private clearAutoCheckTimer(): void {
    if (this.autoCheckTimer !== null) {
      clearTimeout(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
  }

  protected onApiHashInput(value: string): void {
    this.apiHashLive.set(value);
  }

  protected async onSubmitCredentials(
    event: Event,
    apiIdRaw: string,
    apiHash: string,
    dialCode: string,
    nationalNumber: string
  ): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);

    if (!this.credentialsValid()) {
      this.errorMessage.set('API_ID phải là số, API_HASH phải là chuỗi hexa 32 ký tự.');
      return;
    }
    if (!nationalNumber.trim()) {
      this.errorMessage.set('Nhập số điện thoại.');
      return;
    }
    const apiId = Number(apiIdRaw);
    const phoneNumber = toE164(dialCode, nationalNumber);

    this.submitting.set(true);
    try {
      await this.persistCredentials(apiId, apiHash, dialCode, nationalNumber);
      const authorized = await checkSession(apiId);
      this.lastApiId = apiId;
      if (authorized) {
        this.goToDone();
        return;
      }
      await requestLoginCode(apiHash, phoneNumber);
      this.status.set('code');
    } catch (err) {
      this.handleError(err);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onSubmitCode(event: Event, code: string): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      const outcome = await submitOtp(code);
      if (outcome.outcome === 'LoggedIn') {
        this.goToDone();
      } else {
        this.status.set('password');
      }
    } catch (err) {
      await this.resetAfterAuthFailure(err);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onSubmitPassword(event: Event, password: string): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      await submitPassword(password);
      this.goToDone();
    } catch (err) {
      await this.resetAfterAuthFailure(err);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Mã OTP/mật khẩu 2FA sai — backend reset state về `ConnState::
   * Disconnected` thay vì cho retry tại chỗ (`PasswordToken` không `Clone`,
   * xem "Đơn giản hoá có chủ đích" ở src-tauri/src/commands.rs). Phải
   * check_session() lại bằng api_id đã biết để dựng lại `Connected` TRƯỚC
   * khi user bấm gửi mã lần nữa — bỏ qua bước này thì request_login_code kế
   * tiếp báo lỗi "gọi check_session() trước". */
  private async resetAfterAuthFailure(err: unknown): Promise<void> {
    this.handleError(err);
    this.status.set('form');
    if (this.lastApiId !== null) {
      try {
        await checkSession(this.lastApiId);
      } catch {
        // Im lặng: nếu check_session() cũng lỗi, user thấy lại đúng lỗi đó
        // khi bấm "Tiếp tục" lần nữa — không ghi đè errorMessage đang giải
        // thích lý do OTP/mật khẩu sai, thứ đang có giá trị hơn.
      }
    }
  }

  private handleError(err: unknown): void {
    const dto = toIngestRpcError(err);
    this.errorMessage.set(describeIngestError(dto));
    if (dto.kind === 'FloodWait') {
      this.startFloodWaitCountdown(dto.detail.seconds);
    } else {
      this.floodWaitRemaining.set(null);
    }
  }

  private startFloodWaitCountdown(seconds: number): void {
    this.clearFloodWaitTimer();
    this.floodWaitRemaining.set(seconds);
    this.floodWaitTimer = setInterval(() => {
      const remaining = this.floodWaitRemaining();
      if (remaining === null || remaining <= 1) {
        this.clearFloodWaitTimer();
        this.floodWaitRemaining.set(null);
        return;
      }
      this.floodWaitRemaining.set(remaining - 1);
    }, 1000);
  }

  private clearFloodWaitTimer(): void {
    if (this.floodWaitTimer !== null) {
      clearInterval(this.floodWaitTimer);
      this.floodWaitTimer = null;
    }
  }
}
