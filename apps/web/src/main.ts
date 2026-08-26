import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initStreamBridge } from './app/player/stream-bridge';
import { initDebugCapture } from './app/debug/debug-capture';

// Bắt log debug toàn cục — chỉ bật khi URL có `?debug=1`, hiển thị NGAY
// TRONG trang play (xem player.html), dùng để gỡ lỗi streaming (F4) trên
// thiết bị không có Web Inspector từ xa (vd iOS không có Mac). Gọi TRƯỚC
// initStreamBridge() để bắt được cả log ngay từ request đầu tiên.
initDebugCapture();

// Đăng ký SW + bridge chuyển tiếp chunk (F4, ADR-0004 §3) TRƯỚC khi bootstrap
// Angular — không cần chờ framework khởi động xong mới lắng nghe message từ SW.
initStreamBridge();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
