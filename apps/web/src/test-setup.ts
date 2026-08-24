// jsdom (môi trường của @angular/build:unit-test) không cài `Worker` — Login
// tạo Core Worker thật ngay trong field initializer
// (createCoreWorkerClient()), nên MỌI test dựng Login (trực tiếp hay qua
// App) cần `Worker` tồn tại để Comlink.wrap() không throw lúc construct.
// Fake này không chạy MTProto/logic thật, chỉ đủ hình dạng để không crash.
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;

  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
  terminate(): void {}
}

if (typeof globalThis.Worker === 'undefined') {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
}
