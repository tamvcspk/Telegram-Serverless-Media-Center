import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatStepperModule } from '@angular/material/stepper';
import { checkSession, describeIngestError, requestLoginCode, submitOtp, submitPassword, toIngestRpcError } from '../core/ingest-rpc';
import { COUNTRY_DIAL_CODES, toE164 } from './country-codes';

type LoginStatus = 'form' | 'code' | 'password' | 'done';

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

  protected readonly countryDialCodes = COUNTRY_DIAL_CODES;
  protected readonly defaultDialCode = COUNTRY_DIAL_CODES[0].dialCode;

  protected readonly status = signal<LoginStatus>('form');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly floodWaitRemaining = signal<number | null>(null);

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

  constructor() {
    this.destroyRef.onDestroy(() => this.clearFloodWaitTimer());
  }

  protected onApiIdInput(value: string): void {
    this.apiIdLive.set(value);
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
      const authorized = await checkSession(apiId);
      this.lastApiId = apiId;
      if (authorized) {
        this.status.set('done');
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
      this.status.set(outcome.outcome === 'LoggedIn' ? 'done' : 'password');
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
      this.status.set('done');
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
