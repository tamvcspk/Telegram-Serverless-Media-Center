// `tsmc-ingest login` — CLI TỰ hỏi phone/code/2FA ngay trong terminal của
// admin (đã chọn qua AskUserQuestion khi duyệt plan) — admin tự chạy lệnh
// này trong terminal CỦA HỌ, không phải Claude/agent chạy đăng nhập hộ.
import { createTelegramGateway } from '@tsmc/core-mtproto';
import { createNodeSessionStorage } from '../session-storage-node';
import { prompt, promptHidden } from '../prompt';

export async function runLogin(): Promise<void> {
  const apiId = Number(process.env['TSMC_API_ID']);
  const apiHash = process.env['TSMC_API_HASH'];
  if (!apiId || !apiHash) {
    console.error(
      'Thiếu TSMC_API_ID/TSMC_API_HASH — đặt trong biến môi trường HOẶC file .env cùng thư mục chạy CLI (xem apps/tsmc-ingest/.env.example). Tự tạo tại https://my.telegram.org (CLAUDE.md: API_ID/API_HASH do bạn tự cung cấp, không phải bí mật server nào cả).'
    );
    process.exitCode = 1;
    return;
  }

  // TSMC_PHONE_NUMBER tuỳ chọn — điền trong .env để bỏ qua prompt (tiện lúc
  // đăng nhập lại nhiều lần khi test); không có thì hỏi tay như cũ.
  const phoneNumber = process.env['TSMC_PHONE_NUMBER'] || (await prompt('Số điện thoại (định dạng quốc tế, vd +84912345678): '));

  const gateway = createTelegramGateway({ sessionStorage: createNodeSessionStorage(), sessionKeyExtractable: true });
  const user = await gateway.login({ apiId, apiHash }, phoneNumber, {
    async phoneCode(isCodeViaApp) {
      return prompt(`Nhập mã xác nhận Telegram vừa gửi ${isCodeViaApp ? 'qua app' : 'qua SMS'}: `);
    },
    async password(hint) {
      return promptHidden(`Nhập mật khẩu 2FA${hint ? ` (gợi ý: ${hint})` : ''}: `);
    },
    async onError(err) {
      console.error(`Lỗi đăng nhập: ${err.message}`);
      // Dừng hẳn (true) thay vì tự thử lại — an toàn hơn loop vô hạn khi
      // admin gõ sai liên tục; chạy lại `tsmc-ingest login` để thử lần nữa.
      return true;
    }
  });

  console.log(`Đăng nhập thành công: ${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.id}${user.username ? ` (@${user.username})` : ''}.`);
  console.log('Session đã lưu mã hoá tại ~/.tsmc-ingest/session.local.json — không commit file này vào bất kỳ repo nào.');
}
