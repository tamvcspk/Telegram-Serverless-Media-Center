import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import * as Comlink from 'comlink';
import { firstValueFrom } from 'rxjs';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { StateChannelCandidate, StateChannelChoice, TelegramUserSummary } from '@tsmc/shared-models';
import { COUNTRY_DIAL_CODES, toE164 } from './country-codes';
import { SyncStatus } from '../sync/sync-status';
import { StateChannelResolutionDialog } from '../sync/state-channel-resolution-dialog/state-channel-resolution-dialog';

type LoginStatus = 'checking' | 'phone' | 'code' | 'password' | 'authenticated';

/**
 * Màn đăng nhập tối thiểu (F1.1). Wizard 3 bước: API_ID/API_HASH + số điện
 * thoại → mã xác nhận → mật khẩu 2FA (nếu có). Mỗi bước chờ user nhập qua
 * một callback Comlink-proxy được TelegramGateway.login gọi ngược lại từ
 * Core Worker (ADR-0003/0004) — xem libs/core-mtproto/src/gateway.ts.
 */
@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, SyncStatus],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Login {
  private readonly client = createCoreWorkerClient();
  private readonly dialog = inject(MatDialog);

  private pendingCode: ((code: string) => void) | null = null;
  private pendingPassword: ((password: string) => void) | null = null;

  readonly countryDialCodes = COUNTRY_DIAL_CODES;
  readonly defaultDialCode = COUNTRY_DIAL_CODES[0].dialCode;

  readonly status = signal<LoginStatus>('checking');
  readonly user = signal<TelegramUserSummary | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly passwordHint = signal<string | undefined>(undefined);
  readonly codeViaApp = signal(false);
  readonly submitting = signal(false);

  constructor() {
    void this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const summary = await this.client.restoreSession();
      if (summary) {
        this.user.set(summary);
        this.status.set('authenticated');
        void this.initSync();
        return;
      }
    } catch (err) {
      // Phiên cũ lỗi (session chết, hết hạn) không chặn onboarding — chỉ
      // coi như chưa đăng nhập, không phải lỗi cần hiển thị ngay.
      console.warn('[login] restoreSession lỗi:', err);
    }
    this.status.set('phone');
  }

  /**
   * Dò/tạo kênh state + hydrate (ADR-0009/0014) — gọi sau khi đã xác thực,
   * tách khỏi login()/restoreSession() để hai mối quan tâm không lẫn vào
   * nhau. Không chặn UI: lỗi (mất mạng, v.v.) chỉ log, sync-status tự hiện
   * lastError qua liveQuery khi retry ở lần forceFlush() kế tiếp.
   */
  private async initSync(): Promise<void> {
    try {
      await this.client.initSync(
        Comlink.proxy({
          chooseCandidate: (candidates: StateChannelCandidate[]) => this.chooseStateChannel(candidates)
        })
      );
    } catch (err) {
      console.warn('[login] initSync lỗi:', err);
    }
  }

  private async chooseStateChannel(candidates: StateChannelCandidate[]): Promise<StateChannelChoice> {
    const ref = this.dialog.open(StateChannelResolutionDialog, {
      data: { candidates },
      disableClose: true
    });
    const choice = await firstValueFrom(ref.afterClosed());
    // disableClose:true + dialog chỉ close(choice) qua các nút thật —
    // undefined về lý thuyết không xảy ra, nhưng vẫn cần trả một giá trị
    // hợp lệ để không treo resolveStateChannel() phía Core Worker mãi mãi.
    return choice ?? { kind: 'use', channelId: candidates[0].id };
  }

  async onSubmitPhone(
    event: Event,
    apiIdRaw: string,
    apiHash: string,
    dialCode: string,
    nationalNumber: string
  ): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);

    const apiId = Number(apiIdRaw);
    if (!apiId || !apiHash.trim() || !nationalNumber.trim()) {
      this.errorMessage.set('Điền đầy đủ API_ID, API_HASH và số điện thoại.');
      return;
    }
    const phoneNumber = toE164(dialCode, nationalNumber);

    this.submitting.set(true);
    try {
      // QUAN TRỌNG: bọc CẢ object callbacks bằng một Comlink.proxy() duy
      // nhất, không bọc từng hàm rời rồi nhét vào object thường — Comlink
      // chỉ kiểm tra marker proxy ở đối số cấp cao nhất, không đệ quy vào
      // thuộc tính bên trong object thường. Bọc riêng lẻ từng hàm khiến
      // Comlink rơi về structured-clone mặc định của postMessage cho CẢ
      // object chứa (vì bản thân object đó không có marker) → lỗi
      // "could not be cloned" (Chrome) / "the object cannot be cloned"
      // (Safari/iOS) — đã tái hiện thật trên cả hai nền tảng.
      const summary = await this.client.login(
        { apiId, apiHash },
        phoneNumber,
        Comlink.proxy({
          phoneCode: (isCodeViaApp?: boolean) => {
            this.codeViaApp.set(Boolean(isCodeViaApp));
            this.status.set('code');
            return new Promise<string>((resolve) => {
              this.pendingCode = resolve;
            });
          },
          password: (hint?: string) => {
            this.passwordHint.set(hint);
            this.status.set('password');
            return new Promise<string>((resolve) => {
              this.pendingPassword = resolve;
            });
          },
          onError: async (err: Error) => {
            this.errorMessage.set(err.message);
            return false;
          }
        })
      );
      this.user.set(summary);
      this.status.set('authenticated');
      void this.initSync();
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
      this.status.set('phone');
    } finally {
      this.submitting.set(false);
    }
  }

  onSubmitCode(event: Event, code: string): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.pendingCode?.(code);
    this.pendingCode = null;
  }

  onSubmitPassword(event: Event, password: string): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.pendingPassword?.(password);
    this.pendingPassword = null;
  }

  async onLogout(): Promise<void> {
    await this.client.logout();
    this.user.set(null);
    this.errorMessage.set(null);
    this.status.set('phone');
  }
}
