// SessionStoragePort cho CLI — implementation Node của cổng đã tách ra khỏi
// libs/core-mtproto/src/gateway.ts. Bản Dexie (mặc định, web/worker-host) giữ
// nguyên object CryptoKey qua structured clone của IndexedDB; ở đây không có
// cơ chế tương đương (mỗi lần chạy CLI là một tiến trình Node MỚI), nên phải
// tự export/import BYTES của key ra file JSON — đây là lý do
// `createTelegramGateway({ sessionKeyExtractable: true })` bắt buộc phải bật
// (xem gateway.ts, session-crypto.ts).
//
// File lưu ở home directory của admin (`~/.tsmc-ingest/session.local.json`),
// KHÔNG NẰM TRONG REPO — loại bỏ hoàn toàn rủi ro commit nhầm session MTProto
// thật (CLAUDE.md: "Không commit session... *.local.json"), mạnh hơn chỉ dựa
// vào .gitignore.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionRecord, SessionStoragePort } from '@tsmc/core-mtproto';

const SESSION_DIR = join(homedir(), '.tsmc-ingest');
const SESSION_FILE = join(SESSION_DIR, 'session.local.json');

interface SerializedSessionRecord {
  apiId: number;
  apiHash: string;
  ivBase64: string;
  ciphertextBase64: string;
  keyBase64: string;
}

function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const buf = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return Buffer.from(buf).toString('base64');
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function createNodeSessionStorage(): SessionStoragePort {
  return {
    async get(): Promise<SessionRecord | undefined> {
      let raw: string;
      try {
        raw = await readFile(SESSION_FILE, 'utf8');
      } catch {
        return undefined;
      }

      const parsed = JSON.parse(raw) as SerializedSessionRecord;
      const keyBytes = fromBase64(parsed.keyBase64);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

      return {
        id: 'default',
        apiId: parsed.apiId,
        apiHash: parsed.apiHash,
        iv: fromBase64(parsed.ivBase64) as Uint8Array<ArrayBuffer>,
        ciphertext: fromBase64(parsed.ciphertextBase64).buffer as ArrayBuffer,
        cryptoKey
      };
    },

    async put(record: SessionRecord): Promise<void> {
      const keyBytes = await crypto.subtle.exportKey('raw', record.cryptoKey);
      const serialized: SerializedSessionRecord = {
        apiId: record.apiId,
        apiHash: record.apiHash,
        ivBase64: toBase64(record.iv),
        ciphertextBase64: toBase64(record.ciphertext),
        keyBase64: toBase64(keyBytes)
      };

      await mkdir(SESSION_DIR, { recursive: true });
      await writeFile(SESSION_FILE, JSON.stringify(serialized), 'utf8');
      // Chỉ chủ tài khoản đọc được — vô hại trên Windows (không có bit x/rwx
      // thật), chmod là no-op an toàn ở đó.
      await chmod(SESSION_FILE, 0o600).catch(() => undefined);
    },

    async delete(): Promise<void> {
      await rm(SESSION_FILE, { force: true });
    }
  };
}
