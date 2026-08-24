import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreWorkerClient, LIB_NAME } from './index';

describe('@tsmc/worker-host', () => {
  it('compiles and runs under plain Node (no Angular runtime)', () => {
    expect(LIB_NAME).toBe('@tsmc/worker-host');
  });

  it('exposes a factory for the Core Worker RPC client', () => {
    // Không khởi tạo Worker thật ở đây: Worker/import.meta.url là API trình
    // duyệt, môi trường test của libs/* là Node thuần (ADR-0012). Việc gọi
    // được client thật xác nhận trong apps/web lúc build (xem bước kiểm chứng #6).
    expect(typeof createCoreWorkerClient).toBe('function');
  });
});

describe('@tsmc/worker-host createCoreWorkerClient() — singleton cấp module', () => {
  afterEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
    vi.resetModules();
  });

  it('nhiều lời gọi CHỈ tạo đúng một Worker — bug thật: Login và SyncStatus mỗi bên tự gọi hàm này, tạo ra hai Core Worker độc lập, khiến ghi (mutate/forceFlush) rơi vào worker chưa từng login/initSync() mà không lỗi lộ ra', async () => {
    const createdWorkers: unknown[] = [];
    class FakeWorker {
      constructor() {
        createdWorkers.push(this);
      }
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      terminate(): void {}
    }
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;

    vi.resetModules();
    const fresh = await import('./index');

    const first = fresh.createCoreWorkerClient();
    const second = fresh.createCoreWorkerClient();

    expect(second).toBe(first);
    expect(createdWorkers).toHaveLength(1);
  });
});
