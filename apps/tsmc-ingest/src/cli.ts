#!/usr/bin/env node
// Entry point tsmc-ingest — dispatch argv thủ công, không thêm thư viện
// (commander/yargs) cho 3 lệnh đơn giản (đúng tinh thần giữ dependency tối
// thiểu của repo). ADR-0013 mục 1.
import { requireAuthenticatedGateway } from './auth';
import { runLogin } from './commands/login';
import { runProbe } from './commands/probe';
import { runUpload } from './commands/upload';
import { loadDotEnvIfPresent } from './env';

function printUsage(): void {
  console.log(`tsmc-ingest — CLI admin đưa phim vào kho (ADR-0013 mục 1)

Lệnh:
  tsmc-ingest login
      Đăng nhập MTProto (phone/mã xác nhận/2FA qua terminal). Cần biến môi
      trường TSMC_API_ID/TSMC_API_HASH (lấy tại https://my.telegram.org).

  tsmc-ingest probe <file...>
      Chỉ ffprobe + phân hạng compat (A/B/C/D) — không upload, không cần đăng nhập.

  tsmc-ingest upload --channel <ref> [--yes] <file...>
      Pipeline đầy đủ: probe → phân hạng → remux/re-encode → thumbnail →
      metadata (kế thừa được từ tập trước) → upload → publish catalog.json.
      --yes: bỏ qua mọi xác nhận/prompt (batch không tương tác).
`);
}

function parseUploadArgs(args: string[]): { channelRef?: string; assumeYes: boolean; files: string[] } {
  let channelRef: string | undefined;
  let assumeYes = false;
  const files: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--channel') {
      channelRef = args[i + 1];
      i += 1;
    } else if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
    } else {
      files.push(arg);
    }
  }

  return { channelRef, assumeYes, files };
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'login':
      await runLogin();
      return;

    case 'probe':
      await runProbe(rest);
      return;

    case 'upload': {
      const { channelRef, assumeYes, files } = parseUploadArgs(rest);
      if (!channelRef) {
        console.error('Thiếu --channel <ref>. Dùng: tsmc-ingest upload --channel <ref> [--yes] <file...>');
        process.exitCode = 1;
        return;
      }
      const gateway = await requireAuthenticatedGateway();
      await runUpload(gateway, { channelRef, files, assumeYes });
      return;
    }

    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    // Phát hiện thật: CLI treo (không bao giờ thoát) sau `login`/`upload` —
    // GramJS giữ kết nối MTProto mở (WebSocket/TCP + timer keep-alive nội
    // bộ), event loop của Node không bao giờ tự rỗng nếu không exit thẳng.
    // CLI này one-shot (không phải daemon chạy nền), và mọi ghi quan trọng
    // (session ra đĩa, upload/publish lên Telegram) đã `await` xong TRƯỚC
    // khi tới đây — ép thoát ngay không mất dữ liệu gì.
    process.exit(process.exitCode ?? 0);
  });
