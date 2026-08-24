# ADR-0003: GramJS làm MTProto client

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0005](./0005-streaming-qua-service-worker-http-range.md), [ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)

## Bối cảnh

Cần một thư viện MTProto chạy được **trong trình duyệt** (transport WebSocket obfuscated tới `wss://{dc}.web.telegram.org/apiws`), và — quan trọng hơn cả — cho phép **tải file theo offset tuỳ ý**, vì đó là điều kiện sống còn của tính năng tua video ([ADR-0005](./0005-streaming-qua-service-worker-http-range.md)).

Tiêu chí đánh giá, xếp theo mức quan trọng:
1. Truy cập được `upload.getFile(offset, limit)` ở mức thấp — **loại trực tiếp** thư viện nào chỉ cho "tải cả file".
2. Chạy được trong Worker context.
3. Xử lý được multi-DC (`FILE_MIGRATE`, export auth) và `CDN_REDIRECT`.
4. TypeScript, còn được bảo trì, kích thước bundle chấp nhận được.

## Các phương án

### A. TDLib biên dịch WASM (tdweb) — thư viện *chính thức*
- ✅ Chuẩn nhất, cùng lõi với Telegram Web K/Z; xử lý DC, CDN, retry rất chín.
- ❌ **Mô hình file của TDLib là "tải xong vào filesystem ảo"**. Nó có `downloadFile(offset, limit)` nhưng vẫn đi qua lớp file cache nội bộ, và trả kết quả qua IndexedDB-backed FS. Việc ghép nó vào một pipeline streaming HTTP Range là chống lại thiết kế của nó.
- ❌ WASM nhiều MB, thời gian khởi động đáng kể.
- ❌ Debug lỗi nghĩa là debug C++ đã minify — với một dự án cộng đồng thì gần như bất khả thi.

### B. `@mtproto/core`
- ✅ Nhẹ, API sát tầng RPC.
- ❌ Trạng thái bảo trì thất thường; multi-DC/CDN phải tự viết; TypeScript types yếu.

### C. **GramJS (`telegram`) — được chọn**
- ✅ API hai tầng: `client.invoke(new Api.upload.GetFile({...}))` cho kiểm soát tuyệt đối, và `iterDownload({ offset, limit, requestSize })` cho tiện dụng.
- ✅ Có sẵn `StringSession`, quản lý DC/export-auth, hỗ trợ browser (WebSocket + WASM AES-IGE).
- ✅ TypeScript first-class, cộng đồng lớn, dễ đọc mã nguồn khi cần vá.
- ❌ Bundle lớn (BigInt/crypto polyfills); cần lazy-load.
- ❌ Vốn sinh ra cho Node → còn vài chỗ giả định môi trường Node, phải cấu hình bundler cẩn thận.

## Quyết định

Dùng **GramJS**, nhưng **bọc sau một cổng nội bộ** (`TelegramGateway`) — không cho phép bất kỳ tầng nào ngoài `core-mtproto` import trực tiếp từ package `telegram`.

Lý do bọc: rủi ro lớn nhất của lựa chọn này không phải chất lượng thư viện mà là **khoá cứng vào nó**. Nếu spike phát hiện `upload.getCdnFile` không được hỗ trợ đủ, ta phải tự implement phần đó ở tầng RPC — việc này chỉ khả thi khi toàn bộ phần còn lại của app không biết GramJS tồn tại.

Cổng `TelegramGateway` phơi đúng các nghiệp vụ: `login`, `listDialogs`, `getHistoryDelta`, `readChunk(fileRef, offset, length)`, `refreshFileReference`, `appendStateEvent`. Không phơi kiểu dữ liệu của GramJS ra ngoài (convert sang model của dự án ngay tại biên).

## Hệ quả

**Tích cực**: kiểm soát chunk ở mức byte → seek gần như tức thời; đổi thư viện sau này là việc của một package.

**Tiêu cực / phải chấp nhận**
- Ta gánh phần logic mà TDLib làm hộ: retry, migrate, CDN, verify hash. [ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md) tồn tại chính vì lý do này.
- Phải theo dõi thay đổi TL schema khi Telegram cập nhật layer.

**Rủi ro cần spike ngay (Spike #2)**: xác nhận GramJS xử lý được `CDN_REDIRECT` (AES-CTR + `upload.getCdnFileHashes`). Nếu không, chi phí tự implement phải được tính vào roadmap Epic 4 chứ không phát hiện muộn.

## Cập nhật sau khi Accepted (2026-08-23, SPIKE-03)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

Khi cài đặt package `telegram`, npm cảnh báo: **gói đã bị archive, ngừng bảo trì**, khuyến nghị chuyển sang fork `teleproto` đang được duy trì. [SPIKE-03](../spikes/README.md#spike-03) đã bundle thử cả hai cho browser:

| | `telegram` (GramJS, đang dùng) | `teleproto` (fork khuyến nghị) |
|---|---|---|
| Bundle browser | ✅ 236 KB brotli, chạy đúng | ❌ Nặng hơn (328 KB) và **crash lúc khởi tạo** với bộ polyfill chuẩn |
| Mô tả & dependency | Đã kiểm chứng chạy trong Chrome/WebKit thật | Tự mô tả "for Node.js", kéo theo `socks`/`node-localstorage` — nghiêng về backend/userbot |

Nói cách khác: **thư viện đang dùng (GramJS) vẫn là lựa chọn khả thi duy nhất đã được kiểm chứng cho browser** tại thời điểm này — chính "đối thủ" được khuyến nghị lại chưa chạy được trong browser với nỗ lực bundling tiêu chuẩn. Quyết định dùng GramJS ở ADR này **không đổi**.

Điều thay đổi là mức độ nghiêm trọng của rủi ro "khoá cứng vào thư viện" đã nêu ở trên: từ "rủi ro lý thuyết cần phòng xa bằng `TelegramGateway`" thành "rủi ro đang hiện diện — không còn ai vá lỗi/theo kịp thay đổi giao thức Telegram cho gói đang dùng". Lớp bọc `TelegramGateway` chính là thứ giúp rủi ro này **có thể quản lý được** thay vì phải quyết ngay: đổi thư viện lõi sau này là việc của một package, không lan ra toàn bộ codebase.

**Quyết định của chủ dự án (2026-08-23):** giữ GramJS, **ghim cứng phiên bản** `telegram@2.26.22` (không dùng range `^`) trong mọi package tiêu thụ nó. Lý do chọn: đây là lựa chọn duy nhất đã kiểm chứng chạy được trong browser thật ngay hôm nay; đánh đổi rủi ro bảo trì dài hạn lấy tiến độ, và dựa vào `TelegramGateway` để giữ chi phí đổi thư viện về sau ở mức một package thay vì viết lại toàn bộ. Không đầu tư sửa `teleproto` cho browser ở giai đoạn này.

Hệ quả thực thi: pin version chính xác ở mọi `package.json` dùng `telegram`; theo dõi thủ công khi Telegram đổi TL layer làm GramJS hỏng thật (không có CI tự động cảnh báo việc này — ghi vào checklist vận hành khi có, chưa phải việc của giai đoạn kiến trúc).

## Cập nhật sau khi Accepted (2026-08-24, slice Auth F1.1)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

Khi triển khai `TelegramGateway.login` thật và deploy thử lên staging, đăng nhập thật lập tức vỡ ngay bước gửi mã: `hg.default.randomBytes is not a function` — tái hiện được trên **cả Windows Chrome lẫn iOS Safari**, không phải lỗi riêng WebKit.

**Gốc rễ, xác nhận bằng cách đọc source GramJS thật** (không suy đoán): GramJS tự nhận diện "đang chạy Node hay browser" bằng đúng một dòng ở `platform.js`:
```js
exports.isBrowser = !exports.isDeno && typeof window !== "undefined";
exports.isNode = !exports.isBrowser;
```
Dedicated Worker — nơi **duy nhất** được phép chạy GramJS theo [ADR-0004](./0004-mo-hinh-da-luong.md) — không có `window` (Worker global scope chỉ có `self`). GramJS vì vậy **luôn** tưởng nhầm mình đang chạy Node, dù thực tế đang ở trong trình duyệt. Ba hệ quả cụ thể đã xác nhận bằng cách đọc thẳng mã nguồn:

1. `CryptoFile.js` dùng `require("crypto")` kiểu Node để lấy `randomBytes` cho các bước tạo nonce của MTProto handshake. Bundler cần polyfill cho việc này ở trình duyệt — nhưng mặc định của `esbuild-plugin-polyfill-node` là **tắt hẳn** polyfill crypto (`polyfills.crypto = "empty"`), nên build vẫn **thành công** (không lỗi build-time) nhưng vỡ ngay khi chạm runtime. Đây đúng là lỗ hổng verification: [SPIKE-03](../spikes/README.md#spike-03) chỉ đo lúc *nạp* bundle, chưa từng gọi `connect()` nên chưa từng chạm nhánh crypto này.
2. `telegramBaseClient.js` chọn địa chỉ DC mặc định dựa trên `isNode`: tưởng là Node thì dùng thẳng IP thô của DC (`149.154.167.91`) qua `ws://` cổng 80; tưởng là browser thì dùng hostname `*.web.telegram.org` qua `wss://` cổng 443 (`useWSS` cũng suy từ `window.location.protocol`, vốn không tồn tại trong Worker). Nhánh "Node" bị chặn thẳng bởi CSP `connect-src` ([ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)) — và IP thô cũng không có chứng chỉ TLS hợp lệ cho `wss://` dù CSP có cho qua.
3. `Helpers.js` gọi `.unref()` trên id của timer khi tưởng là Node — `number` trả về từ `setTimeout` của trình duyệt/Worker không có method này, sẽ crash nếu nhánh đó từng được thực thi (chưa gặp thật, nhưng cùng gốc rễ).

**Sửa tại nguồn (patch GramJS) không khả thi/không nên** — đây là dependency ghim cứng đã bị archive (xem addendum trên). Thay vào đó, `libs/core-mtproto/src/browser-shim.ts` gán `globalThis.window = self` **trước khi** `telegram` được import lần đầu (thứ tự import quyết định thời điểm `platform.js` tính `isBrowser`) — vá đúng gốc rễ, sửa cả 3 hệ quả trên cùng lúc thay vì ba bản vá rời rạc.

**Đã verify bằng kết nối MTProto thật** (dùng credential giả — không phải tài khoản người dùng thật, đúng ranh giới an toàn của CLAUDE.md): sau khi vá, kết nối đúng tới `vesta.web.telegram.org`, và nhận đúng lỗi thật từ server Telegram (`400: API_ID_INVALID`, đúng vì API_ID là giả) thay vì crash phía client. Xác nhận pipeline kết nối MTProto trong Worker chạy đúng end-to-end.

**Điều thay đổi**: rủi ro "khoá cứng vào GramJS" đã ghi ở addendum trước nặng thêm một chút — không chỉ là "gói bị archive, không ai vá lỗi giao thức", mà còn là "gói còn giả định môi trường Node ở nhiều chỗ, phải tự dò và vá từng quirk khi chạm tới". Lớp bọc `TelegramGateway`/`browser-shim.ts` tiếp tục giữ chi phí này ở đúng một package — quyết định giữ GramJS **không đổi**.
