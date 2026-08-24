// GramJS tự nhận diện "đang chạy trong browser hay Node" bằng đúng một dòng
// (platform.js): `isBrowser = typeof window !== "undefined"`. Bên trong một
// Dedicated Worker — nơi DUY NHẤT được phép chạy GramJS theo ADR-0004 —
// KHÔNG có `window` (Worker global scope chỉ có `self`), nên GramJS luôn
// tưởng nhầm mình đang chạy Node dù thực tế đang ở trình duyệt. Hệ quả đã
// tái hiện được thật (không phải giả thuyết):
//   - `hg.default.randomBytes is not a function` — nhánh "Node" load
//     `require("crypto")` thay vì dùng polyfill (đã vá riêng ở
//     libs/worker-host/build.mjs bằng polyfillNode({polyfills:{crypto:true}})).
//   - Kết nối thẳng vào IP DC thô qua ws://<ip>:80 (client/telegramBaseClient.js
//     DEFAULT_IPV4_IP/useWSS) thay vì wss://<dc>.web.telegram.org:443 — bị
//     chặn bởi CSP connect-src (ADR-0011) và không có TLS hợp lệ cho IP thô.
//   - `Helpers.js`.sleep(ms, true) gọi `.unref()` trên timer id — number
//     trong trình duyệt/Worker không có method này, sẽ crash nếu nhánh đó
//     từng chạy tới.
//
// Sửa tại nguồn (patch GramJS) không khả thi/không nên — đây là dependency
// ghim cứng, đã archive (ADR-0003). Thay vào đó, giả lập tối thiểu `window`
// TRƯỚC KHI import 'telegram' lần đầu (thứ tự import quyết định: side-effect
// import này phải đứng trước import 'telegram' trong gateway.ts) để
// `platform.js` tính đúng `isBrowser=true` ngay từ đầu. `self` (Worker
// global scope) đã có `location`/`addEventListener` thật nên gán thẳng,
// không cần tự dựng object giả.
// Vitest/Node (test:libs) không có cả `window` lẫn `self` — khác Worker
// thật (có `self`, không có `window`) và khác Node cũ điển hình mà
// platform.js nhắm tới. Chỉ patch khi đang ở trong một global scope kiểu
// Worker/browser thật (có `self`) và `window` thật sự chưa tồn tại.
if (
  typeof (globalThis as unknown as { self?: unknown }).self !== 'undefined' &&
  typeof (globalThis as unknown as { window?: unknown }).window === 'undefined'
) {
  // `self` ở đây LÀ Worker global scope thật lúc chạy; TS gọi nó là `Window`
  // chỉ vì tsconfig của package này không khai báo lib "webworker" riêng.
  (globalThis as unknown as { window: unknown }).window = self;
}
