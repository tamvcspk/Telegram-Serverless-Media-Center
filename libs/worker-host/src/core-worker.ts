import * as Comlink from 'comlink';

// Bootstrap thật của Core Worker — ADR-0004. Ở bước này chỉ có một RPC `ping`
// để chứng minh pipeline Worker + Comlink + esbuild bundling chạy đúng trong
// @angular/build:application trước khi slice Auth (F1.1) gắn TelegramGateway,
// download scheduler, Dexie writer, và Sync Engine thật vào đây.
const api = {
  ping: async (): Promise<'pong'> => 'pong'
};

export type CoreWorkerApi = typeof api;

Comlink.expose(api);
