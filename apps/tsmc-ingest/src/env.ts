// Đọc `.env` cục bộ cho TSMC_API_ID/TSMC_API_HASH — dùng thẳng
// `process.loadEnvFile()` built-in của Node (>=20.12, ổn định trong nhánh
// >=22 mà repo yêu cầu), KHÔNG thêm package `dotenv` (giữ dependency tối
// thiểu, cùng tinh thần đã áp dụng cho argv parsing/prompt terminal ở CLI
// này). Đã verify thật: `loadEnvFile()` TỰ không ghi đè biến môi trường đã
// có sẵn trước đó (export tay trong shell luôn thắng `.env`, đúng convention
// dotenv quen thuộc) — không cần code thêm để giữ hành vi đó.
import { existsSync } from 'node:fs';

const ENV_FILE = '.env';

export function loadDotEnvIfPresent(): void {
  if (!existsSync(ENV_FILE)) {
    return;
  }
  process.loadEnvFile(ENV_FILE);
}
