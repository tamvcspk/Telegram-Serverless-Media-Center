// Dựng TelegramGateway đã đăng nhập — tách khỏi commands/upload.ts để lệnh
// đó chỉ cầm interface hẹp IngestGateway (@tsmc/core-ingest), không tự lo
// việc khôi phục session. TelegramGateway (core-mtproto) THOẢ MÃN cấu trúc
// IngestGateway (đủ 5 method: resolveIndexChannel/getPinnedCatalogDocument/
// uploadVideoDocument/uploadSubtitleDocument/publishCatalogDocument) nên
// truyền thẳng được, không cần adapter thủ công.
import { createTelegramGateway, type TelegramGateway } from '@tsmc/core-mtproto';
import { createNodeSessionStorage } from './session-storage-node';

export async function requireAuthenticatedGateway(): Promise<TelegramGateway> {
  const gateway = createTelegramGateway({ sessionStorage: createNodeSessionStorage(), sessionKeyExtractable: true });
  const user = await gateway.restoreSession();
  if (!user) {
    console.error('Chưa đăng nhập (hoặc session đã hết hạn) — chạy `tsmc-ingest login` trước.');
    process.exit(1);
  }
  return gateway;
}
