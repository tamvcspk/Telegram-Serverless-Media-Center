import Dexie, { type Table } from 'dexie';

// Bản ghi session mã hoá (ADR-0011). Mã hoá/giải mã thuộc về core-mtproto —
// package này chỉ lưu/đọc bytes thuần, không chứa logic crypto.
export interface SessionRecord {
  id: 'default';
  apiId: number;
  apiHash: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  cryptoKey: CryptoKey;
}

class TsmcDatabase extends Dexie {
  session!: Table<SessionRecord, string>;

  constructor() {
    super('tsmc');
    // Version 1 — chỉ store `session` (slice F1.1). Sáu store còn lại của
    // ADR-0007 (sources/media/fileRefs/progress/collections/outbox/
    // searchIndex) thêm ở version sau, khi slice thực sự cần tới.
    this.version(1).stores({
      session: 'id'
    });
  }
}

let db: TsmcDatabase | undefined;

function getDb(): TsmcDatabase {
  db ??= new TsmcDatabase();
  return db;
}

export async function getSessionRecord(): Promise<SessionRecord | undefined> {
  return getDb().session.get('default');
}

export async function putSessionRecord(record: SessionRecord): Promise<void> {
  await getDb().session.put(record);
}

export async function deleteSessionRecord(): Promise<void> {
  await getDb().session.delete('default');
}
