// SPIKE-03: entry point tối thiểu để đo trọng lượng thật sự cần cho Core Worker
// (ADR-0003/0004) — chỉ import đúng những gì login + đọc file cần dùng.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

// Không gọi connect() — SPIKE-03 chỉ đo chi phí *nạp và khởi tạo*, việc
// chặn màn hình đăng nhập ([ADR-0003](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md))
// xảy ra ở bước này, trước khi có bất kỳ round-trip mạng nào.
globalThis.__spike03 = { TelegramClient, StringSession };
