import { describe, expect, it } from 'vitest';
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
