import * as Comlink from 'comlink';
import type { CoreWorkerApi } from './core-worker';

export const LIB_NAME = '@tsmc/worker-host' as const;

// apps/web KHÔNG được import core-mtproto/core-download trực tiếp — chỉ qua
// hàm này (ADR-0012 §2, CLAUDE.md bất biến #4). Mỗi lời gọi tạo một Core Worker
// riêng cho tab hiện tại; correlation id trên từng message là trách nhiệm của
// API RPC thật sẽ thay thế `ping` khi slice Auth triển khai (CLAUDE.md).
export function createCoreWorkerClient(): Comlink.Remote<CoreWorkerApi> {
  const worker = new Worker(new URL('./core-worker.ts', import.meta.url), { type: 'module' });
  return Comlink.wrap<CoreWorkerApi>(worker);
}
