// Device id ngẫu nhiên, sinh một lần, dùng làm phần "dev" trong mọi sự kiện
// và làm khoá phá hoà LWW — ADR-0009.
import type { SyncStoragePort } from './storage-port';

export async function ensureDeviceId(storage: SyncStoragePort): Promise<string> {
  const meta = await storage.getSyncMeta();
  if (meta.deviceId) {
    return meta.deviceId;
  }
  const deviceId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  await storage.putSyncMeta({ deviceId });
  return deviceId;
}
