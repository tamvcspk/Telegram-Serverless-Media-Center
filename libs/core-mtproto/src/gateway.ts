// PHẢI đứng trước import 'telegram': patch globalThis.window trước khi
// platform.js của GramJS tính isBrowser (xem browser-shim.ts).
import './browser-shim';
import { Api, TelegramClient, sessions } from 'telegram';
import type { LoginCallbacks, TelegramCredentials, TelegramUserSummary } from '@tsmc/shared-models';
import { deleteSessionRecord, getSessionRecord, putSessionRecord } from '@tsmc/core-storage';
import { decryptSessionString, encryptSessionString, generateSessionKey } from './session-crypto';

const { StringSession } = sessions;

// 60s mặc định của GramJS: FLOOD_WAIT dưới ngưỡng này được tự động chờ
// (đúng tinh thần "tôn trọng FLOOD_WAIT" — CLAUDE.md); trên ngưỡng thì
// FloodWaitError nổi lên onError() để hiển thị cho user, không tự dồn dập.
const FLOOD_SLEEP_THRESHOLD_SECONDS = 60;

export interface TelegramGateway {
  login(credentials: TelegramCredentials, phoneNumber: string, callbacks: LoginCallbacks): Promise<TelegramUserSummary>;
  restoreSession(): Promise<TelegramUserSummary | null>;
  logout(): Promise<void>;
}

function toUserSummary(user: Api.TypeUser): TelegramUserSummary {
  if (!(user instanceof Api.User)) {
    throw new Error('Không lấy được thông tin tài khoản người dùng (user rỗng hoặc đã bị xoá).');
  }
  return {
    id: user.id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    phone: user.phone
  };
}

/**
 * TelegramGateway — ADR-0003. Nơi duy nhất trong repo được phép import
 * package `telegram`; không type nào của GramJS/`Api.*` rò ra ngoài package
 * này, mọi tầng khác chỉ thấy DTO từ `@tsmc/shared-models`.
 */
export function createTelegramGateway(): TelegramGateway {
  let client: TelegramClient | undefined;

  async function persistSession(credentials: TelegramCredentials, sessionString: string): Promise<void> {
    const cryptoKey = await generateSessionKey();
    const { iv, ciphertext } = await encryptSessionString(cryptoKey, sessionString);
    await putSessionRecord({ id: 'default', apiId: credentials.apiId, apiHash: credentials.apiHash, iv, ciphertext, cryptoKey });
  }

  return {
    async login(credentials, phoneNumber, callbacks) {
      const stringSession = new StringSession('');
      client = new TelegramClient(stringSession, credentials.apiId, credentials.apiHash, {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_SECONDS
      });
      await client.connect();

      const user = await client.signInUser(credentials, {
        phoneNumber,
        phoneCode: callbacks.phoneCode,
        password: callbacks.password,
        onError: callbacks.onError
      });

      await persistSession(credentials, stringSession.save());
      return toUserSummary(user);
    },

    async restoreSession() {
      const record = await getSessionRecord();
      if (!record) {
        return null;
      }

      const sessionString = await decryptSessionString(record.cryptoKey, record.iv, record.ciphertext);
      client = new TelegramClient(new StringSession(sessionString), record.apiId, record.apiHash, {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_SECONDS
      });
      await client.connect();

      const authorized = await client.checkAuthorization();
      if (!authorized) {
        // File_reference/access có thể lệch nhưng đây là AUTH_KEY chết hẳn —
        // không phải trường hợp "refresh on-demand" của ADR-0006/C5.
        await deleteSessionRecord();
        return null;
      }

      return toUserSummary(await client.getMe());
    },

    async logout() {
      // Vô hiệu hoá session phía server TRƯỚC khi xoá local — xoá local
      // trước sẽ để lại một session sống trong danh sách thiết bị của user
      // mà app không còn cách nào thu hồi (ADR-0011).
      if (client) {
        await client.invoke(new Api.auth.LogOut());
      }
      await deleteSessionRecord();
    }
  };
}
