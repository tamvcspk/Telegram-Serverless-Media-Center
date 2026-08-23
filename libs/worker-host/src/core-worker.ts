import * as Comlink from 'comlink';
import { createTelegramGateway } from '@tsmc/core-mtproto';

// Bootstrap thật của Core Worker — ADR-0004. Chỉ Core Worker được mở kết nối
// MTProto (CLAUDE.md bất biến #2). File này KHÔNG được bundle qua cơ chế
// split-chunk mặc định của Angular CLI (new URL(..., import.meta.url)) —
// GramJS cần polyfill fs/net/tls không có trong esbuild builder của Angular.
// Build riêng bằng build.mjs, tái dùng cấu hình đã kiểm chứng ở SPIKE-03.
const gateway = createTelegramGateway();

const api = {
  login: gateway.login.bind(gateway),
  restoreSession: gateway.restoreSession.bind(gateway),
  logout: gateway.logout.bind(gateway)
};

export type CoreWorkerApi = typeof api;

Comlink.expose(api);
