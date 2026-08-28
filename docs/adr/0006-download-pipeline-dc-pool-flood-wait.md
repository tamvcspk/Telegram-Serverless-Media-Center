# ADR-0006: Download pipeline — DC pool, độ song song, FLOOD_WAIT

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md)

## Bối cảnh

Vì đã chọn tầng RPC thấp thay vì TDLib ([ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md)), ta phải tự gánh phần "khó và bẩn" của việc tải file:

- File nằm trên DC khác DC nhà → `FILE_MIGRATE_X`, cần `auth.exportAuthorization` / `auth.importAuthorization` cho DC đó.
- Một kết nối MTProto tuần tự chỉ đạt vài MB/s; muốn đủ bitrate cho 4K phải mở **nhiều kết nối tải song song** tới cùng DC.
- `FLOOD_WAIT_X` xuất hiện khi tải quá hăng. Đây là **tài khoản thật của user** — bị hạn chế nghĩa là user mất Telegram cá nhân, không chỉ mất phim.
- File lớn/phổ biến có thể trả `FILE_REF_EXPIRED` hoặc chuyển hướng CDN (`upload.getCdnFile`, cần AES-CTR và kiểm tra hash riêng).

Câu hỏi cốt lõi: **tải nhanh tới đâu thì dừng?**

## Quyết định

### 1. Connection pool theo từng DC
- Mỗi DC có pool riêng, mặc định **4 sender tải** (tách hẳn khỏi sender chính đang giữ update loop — không bao giờ tải file trên kết nối chính, vì như vậy sẽ làm nghẽn cả nhận tin nhắn lẫn auth).
- Sender được tạo lười và đóng sau 60 giây không dùng.
- Auth cho DC lạ được export một lần rồi cache trong session.

### 2. Scheduler theo cửa sổ, ưu tiên theo mốc phát
Hàng đợi chunk có **ưu tiên**, không phải FIFO:

| Ưu tiên | Loại chunk |
|---|---|
| P0 | Chunk chứa vị trí phát hiện tại (user đang chờ) |
| P1 | Chunk readahead trong cửa sổ hiện tại |
| P2 | Chunk đầu file cho các phim khác (prefetch để mở nhanh) |
| P3 | Tải nền (nếu sau này có tính năng tải offline) |

Khi seek: mọi P0/P1 cũ bị **huỷ ngay**, không đợi hoàn tất. Huỷ là mặc định, không phải trường hợp ngoại lệ.

### 3. Độ song song thích ứng (AIMD)
Bắt đầu từ 2 request đồng thời/DC, tăng dần từng nấc khi các chunk liên tiếp thành công, **giảm một nửa** ngay khi gặp `FLOOD_WAIT` hoặc timeout. Trần cứng mặc định là 4, cho phép user nâng lên 8 trong Cài đặt kèm cảnh báo rõ ràng về rủi ro tài khoản.

Lý do chọn AIMD thay vì một hằng số: dung lượng đường truyền và ngưỡng chịu đựng của Telegram khác nhau theo tài khoản, theo DC và theo thời điểm. Số cố định thì hoặc quá chậm, hoặc gây `FLOOD_WAIT` cho một nhóm user.

### 4. Tôn trọng FLOOD_WAIT tuyệt đối
- `FLOOD_WAIT_X` → **chờ đủ X giây**, không retry sớm, không thử DC khác để né. Việc né tránh có hệ thống là hành vi lạm dụng và làm tăng nguy cơ tài khoản bị hạn chế.
- Nếu `X` lớn hơn 60 giây: dừng pipeline, hiện thông báo cho user ("Telegram đang giới hạn tốc độ, thử lại sau N phút") thay vì âm thầm treo. Trạng thái này phải nhìn thấy được trên UI.
- Circuit breaker cho mỗi DC: 3 lần FLOOD liên tiếp thì cho DC đó nghỉ theo backoff luỹ thừa.

### 5. Làm mới `file_reference`
`FILE_REF_EXPIRED` **không phải lỗi** mà là đường đi bình thường: gọi lại `messages.getMessages` cho message gốc, rút reference mới, ghi lại vào cache metadata, thử lại chunk. Toàn bộ việc này phải trong suốt với tầng trên — người dùng không bao giờ được thấy lỗi này.

### 6. Chuyển hướng CDN
Xử lý `CDN_REDIRECT`: dùng `upload.getCdnFile`, giải mã AES-CTR, xác minh qua `upload.getCdnFileHashes`. **Không được bỏ qua bước xác minh hash** — CDN của Telegram là bên thứ ba không đáng tin theo thiết kế của chính giao thức.

## Các phương án đã cân nhắc

| Phương án | Đánh giá |
|---|---|
| Một kết nối tuần tự, đơn giản nhất | Không đủ băng thông cho 4K; loại |
| Mở tối đa kết nối để đạt tốc độ cao nhất | Đẩy rủi ro hạn chế tài khoản sang user để đổi lấy con số benchmark đẹp. Loại vì lý do đạo đức sản phẩm, không chỉ kỹ thuật. |
| **AIMD với trần thấp, user tự chọn nâng** | Được chọn: mặc định an toàn, người dùng nâng cao vẫn có lối ra |

## Hệ quả

**Tích cực**: đủ nhanh cho phần lớn nội dung; suy giảm êm khi mạng kém; hành vi thân thiện với hạ tầng Telegram.

**Tiêu cực / phải chấp nhận**
- Phức tạp thật sự nằm ở đây. Cần bộ test riêng cho scheduler với một `FakeTransport` mô phỏng độ trễ, FLOOD_WAIT, migrate và reference hết hạn. Không có bộ test này thì mọi bug streaming đều không tái hiện được.
- Tốc độ không thể sánh với một trình tải chuyên dụng chạy 16 luồng — đây là đánh đổi có chủ ý.
- Cần telemetry cục bộ (chỉ hiển thị trong `#/debug`, không gửi đi đâu — xem [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md)) để chẩn đoán khi user báo lỗi.

## Cập nhật sau khi Accepted (2026-08-26, slice Playback F4 — vertical slice tối thiểu)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Slice F4 ship **§1 (đơn giản hoá: 1 sender/DC, không pool nhiều sender) + §4 (tôn trọng FLOOD_WAIT tuyệt đối)** của Quyết định trên, KHÔNG làm §2 (scheduler ưu tiên P0-P3), §3 (AIMD), §5 (làm mới file reference — có làm, nhưng đơn giản: refresh một lần khi gateway báo hết hạn, không phân biệt tình huống) đầy đủ, §6 (CDN redirect — ném lỗi rõ ràng "chưa hỗ trợ" thay vì implement, xem [ADR-0005 addendum](./0005-streaming-qua-service-worker-http-range.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-playback-f4--vertical-slice-tối-thiểu)).

**Đã verify bằng phát video thật** (tài khoản thật, Windows Chrome): tải tuần tự sub-chunk 512 KB qua `client.getSender(dcId)` + `client.invokeWithSender(upload.GetFile)` (không dùng `DirectDownloadIter` của GramJS trực tiếp — cần tự kiểm soát abort/FLOOD_WAIT) đủ nhanh cho một cửa sổ 1 MB/lần, không gặp `FLOOD_WAIT` trong quá trình test. SPIKE-04 (đo tốc độ/ngưỡng FLOOD_WAIT thật với 2/4/8 kết nối song song) **vẫn chưa chạy** — mọi tham số AIMD cho slice sau vẫn là giả thuyết, chưa có số liệu thiết bị thật.

Bộ test `FakeTransport` mà mục "Tiêu cực" trên yêu cầu đã có — `libs/core-download/src/test-fakes.ts` + `download-engine.spec.ts` (6 test: windowing, FLOOD_WAIT ≤60s tự chờ, >60s ném lỗi, file reference hết hạn tự làm mới, cancel cắt vòng lặp sớm). Chưa test AIMD/multi-connection vì chưa xây.

## Cập nhật sau khi Accepted (2026-08-26, SPIKE-04)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

[SPIKE-04](../spikes/README.md#spike-04) đã đóng — 🟡 **chấp nhận rủi ro**, không phải 🟢 đã gỡ. `tools/spike-04/bench.mjs` đo tải thật qua `upload.getFile` ở đúng hai mức sản phẩm dùng (§3 Quyết định gốc: mặc định 4, trần nâng cấp 8), trên một tài khoản test, kênh "Group học tập", file 1384 MB, DC 5, chunk 512 KB:

| Lần chạy | Mức | Chunk OK | Thời gian | Throughput | `FLOOD_WAIT` |
|---|---|---|---|---|---|
| Burst (20 MB/mức) | 2 | 40/40 | 3670 ms | 5.71 MB/s | không |
| Burst (20 MB/mức) | 4 | 40/40 | 1471 ms | 14.26 MB/s | không |
| Burst (20 MB/mức) | 8 | 40/40 | 631 ms | 33.25 MB/s | không |
| Sustained (500 MB/mức) | 4 | 1000/1000 | 26106 ms | 20.08 MB/s | không |
| Sustained (500 MB/mức) | 8 | 1000/1000 | 16761 ms | 31.28 MB/s | không |

Tổng ~1.1 GB, 0 lỗi, 0 `FLOOD_WAIT`, throughput không suy giảm theo thời gian ở tải sustained (20–31 MB/s duy trì suốt 17–26 giây).

**Đọc đúng bản chất — cùng cách SPIKE-02 đã tự sửa lưng chính nó:** đây là kết quả "chưa từng gặp `FLOOD_WAIT`", **không phải** "đã xác nhận trần 8 an toàn tuyệt đối". Ngưỡng thật của Telegram chưa lộ ra trong lần chạy này — có thể do kênh test nhỏ/riêng tư, hoặc do ~1.1 GB vẫn chưa đủ khối lượng để kích hoạt giới hạn trên tài khoản/DC/thời điểm này. Quyết định đóng spike ở đây (không dò tiếp lên nhiều GB) vì mục tiêu đạo đức đã nêu ở SPIKE-04 là "tìm trần an toàn, không phải tốc độ tối đa", và sản phẩm đã tự giới hạn cứng ở mức 8 bất kể ngưỡng thật của Telegram cao hơn bao nhiêu — cố dò tới khi tài khoản test bị `FLOOD_WAIT` chỉ để có thêm một con số chính xác hơn không đổi được thiết kế.

**Điều gì THAY ĐỔI:** không gì trong Quyết định gốc — AIMD (bắt đầu thấp, giảm một nửa khi gặp `FLOOD_WAIT`) vẫn là cơ chế đúng cần xây ở slice hardening sau F4, chưa có lý do hạ trần mặc định 4 hay bỏ trần nâng cấp 8.

**Điều gì KHÔNG thay đổi nhưng cần nói rõ hơn — một phát hiện thiết kế phát sinh khi viết `bench.mjs`, quan trọng hơn số throughput ở trên:** `client.getSender(dcId)` của GramJS (`telegram@2.26.22`, xem `node_modules/telegram/client/telegramBaseClient.js`) cache **đúng một** exported sender cho mỗi `dcId` (`_exportedSenderPromises`) — không có API công khai để mở nhiều `MTProtoSender` song song tới cùng DC. §1 của Quyết định gốc ("pool riêng, mặc định 4 sender tải/DC") đọc theo nghĩa đen là 4 kết nối MTProto vật lý tách biệt; cái F4 **thực tế đang dùng** (`libs/core-mtproto/src/gateway-download.ts`, `client.getSender(ref.dcId)`) và cái SPIKE-04 vừa đo được đều là **N request `upload.getFile` multiplex đồng thời trên MỘT sender/kết nối MTProto**, không phải N kết nối vật lý. Hai mô hình này có thể có đặc tính giới hạn tốc độ khác nhau ở phía Telegram (multiplex trên 1 kết nối vs. N kết nối TCP riêng) — số liệu ở trên chỉ xác nhận an toàn cho mô hình multiplex-trên-1-sender đang chạy thật, **không tự động suy rộng** sang một pool nhiều sender thật nếu sau này có ai xây nó (sẽ cần tự khởi tạo `MTProtoSender` thủ công, bỏ qua lớp cache của client — chưa được xây ở đâu cả, kể cả ở spike này).

## Cập nhật sau khi Accepted (2026-08-26, slice hardening — AIMD + circuit breaker + CDN redirect)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

Slice này ship **§3 (AIMD)**, **§4 (circuit breaker theo DC)**, và **§6 (CDN redirect + AES-CTR + xác minh hash)** của Quyết định gốc — phần còn lại (§2, scheduler ưu tiên P0-P3) để lại: cần một tính năng prefetch đa video mà app chưa có UI nào dùng tới, xây trước sẽ là hạ tầng không người tiêu thụ.

### AIMD (§3) — `libs/core-download/src/download-engine.ts`

Mỗi DC giữ một state `{ concurrency, consecutiveOk, consecutiveFloods, restUntil, nextBackoffMs }`, sống trong `Map` theo `dcId`, tồn tại xuyên suốt vòng đời `createDownloadEngine()` (không reset mỗi `fetchWindow()` — đây chính là phần "thích ứng"). Bắt đầu 2 request song song/DC (đúng §3), +1 sau mỗi `concurrency` lần sub-chunk thành công LIÊN TIẾP, trần mặc định 4 (`opts.maxConcurrency`, chưa có Settings UI để user tự nâng lên 8 — known gap, để lại cho slice sau), trần cứng tuyệt đối 8 (`HARD_CEILING_CONCURRENCY`, clamp bất kể `opts` truyền gì lớn hơn). `fetchWindow()` giờ chạy một worker pool (N = `dcState.concurrency` worker, cùng kéo từ một cursor chung trên danh sách offset cần tải cho cửa sổ đó) thay cho vòng lặp tuần tự cũ.

**Phát hiện quan trọng làm lệch cách hiểu "phản ứng với FLOOD_WAIT" so với văn bản gốc §3 ("giảm một nửa NGAY KHI gặp FLOOD_WAIT")** — không phải một lựa chọn thiết kế, mà là một ràng buộc thật lộ ra khi đọc thẳng mã nguồn `telegram@2.26.22`: `gateway.ts` khởi tạo `TelegramClient` với `floodSleepThreshold: 60`. `client/users.js`'s `invoke()` (mà `invokeWithSender()` — thứ `gateway-download.ts` dùng — gọi chung xuống) bọc sẵn:

```js
if (e.seconds <= client.floodSleepThreshold) {
  await sleep(e.seconds * 1000);
  // retry cùng request, KHÔNG ném lỗi
} else {
  throw e;
}
```

Nghĩa là GramJS **tự chờ và retry trong suốt MỌI `FloodWaitError` có `seconds` ≤ 60** trước khi lỗi có cơ hội ném ra tới `gateway-download.ts` — tầng này (và `download-engine.ts` phía trên nó) **không bao giờ quan sát được** một FLOOD_WAIT ≤ 60s; tín hiệu flood duy nhất từng thấy được là loại đã VƯỢT ngưỡng 60s, đúng lúc §4 ("dừng pipeline, báo UI") cũng đã kích hoạt. `floodSleepThreshold` là cấu hình **cấp client**, dùng chung cho cả sync/index/download — hạ nó xuống 0 chỉ để download quan sát được flood nhỏ sẽ khiến MỌI RPC khác (gửi event sync, quét index...) mất luôn hành vi tự-chờ-trong-suốt đang hoạt động tốt, ngoài phạm vi slice này.

Vì vậy: AIMD triển khai thật phản ứng với **"flood nghiêm trọng"** (đã vượt 60s — luôn dừng cả cửa sổ ngay lập tức VÀ giảm một nửa `concurrency` cho DC đó), không phải với "mọi FLOOD_WAIT" theo nghĩa đen của §3. Quyết định gốc §3 **vẫn đứng** — AIMD với trần thấp, tăng dần/giảm mạnh vẫn là cơ chế đúng — addendum này chỉ làm rõ tín hiệu đầu vào thực tế hẹp hơn cách đọc theo nghĩa đen.

Hệ quả trực tiếp: nhánh tự `helpers.sleep()` cũ trong `gateway-download.ts` (cho FLOOD_WAIT ≤ ngưỡng) là **dead code** — không bao giờ chạy tới, vì GramJS đã lọc sẵn — nên đã **xoá**. `fetchFileChunk()` giờ luôn ném `FloodWaitTooLongError` ngay khi bắt được `errors.FloodWaitError`.

### Circuit breaker (§4)

3 lần flood-nghiêm-trọng (>60s) **liên tiếp** trên cùng DC → DC đó "nghỉ" theo backoff luỹ thừa (bắt đầu 2s, nhân đôi mỗi lần trip tiếp theo, trần 60s — cùng ngưỡng "phải hiện cho user" ở §4). Trong lúc nghỉ, request mới tới DC đó bị chặn **ngay ở đầu** `fetchWindow()` (ném `FloodWaitTooLongError` với số giây còn lại) — không tốn round-trip mạng nào, đúng tinh thần "không âm thầm treo".

### CDN redirect (§6) — `libs/core-mtproto/src/gateway-download.ts`

Thay `CdnNotSupportedError` cũ. Trên `Api.upload.FileCdnRedirect`: gọi `upload.GetCdnFile` trên sender của **DC CDN** (`redirect.dcId`, không phải DC gốc) → giải mã bằng `crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 32 }, key, ciphertext)` — WebCrypto **native** của Worker global scope, không dùng crypto nội bộ của GramJS. Counter = `encryptionIv` cộng `offset / 16` (số khối AES 16-byte) vào 4 byte CUỐI, big-endian, tràn số mod 2³² (`offset` luôn bội số 16 nên phép chia luôn tròn, không có phần dư cần xử lý); `length: 32` báo cho WebCrypto biết chỉ 4 byte cuối là bộ đếm tăng dần, 12 byte đầu là nonce cố định — khớp đúng ngữ nghĩa counter mà giao thức CDN của Telegram mô tả.

Xác minh bằng SHA-256 (`crypto.subtle.digest`) so với `FileCdnRedirect.fileHashes` (dùng trực tiếp nếu đã phủ hết `[offset, offset+limit)` yêu cầu — trường hợp thường gặp vì đây chính là redirect cho ĐÚNG request đó; fallback gọi riêng `upload.GetCdnFileHashes` nếu chưa đủ). Có khoảng trống không đoạn hash nào phủ tới, hoặc một đoạn không khớp, đều ném `CdnHashMismatchError` — **không trả bytes chưa xác minh được**, đúng mandate "không được bỏ qua bước xác minh hash" của §6 gốc.

`Api.upload.CdnFileReuploadNeeded` → gọi `upload.ReuploadCdnFile` trên sender **DC gốc** (không phải DC CDN) rồi thử lại `GetCdnFile` đúng một lần.

**Đơn giản hoá có chủ đích:** không cache trạng thái redirect giữa các sub-chunk khác nhau — mỗi sub-chunk tự xin lại redirect từ DC gốc (một round-trip dư mỗi sub-chunk CDN so với một client "nhớ" fileToken/key/iv giữa các lần gọi). Chấp nhận được: [SPIKE-02](../spikes/README.md#spike-02) ghi nhận 0/250 lần gặp `CDN_REDIRECT` thật trên use-case chính của TSMC — đường này gần như không bao giờ chạy tới, một cache phiên CDN đúng nghĩa là đầu tư không tương xứng ở slice này.

**Ràng buộc độ tin cậy cần nói rõ, không phải trình bày như đã kiểm chứng:** implementation CDN redirect viết theo đặc tả TL schema (`upload.GetCdnFile`/`GetCdnFileHashes`/`ReuploadCdnFile`, `upload.FileCdnRedirect`) và hiểu biết về ngữ nghĩa AES-CTR-counter-theo-offset của giao thức Telegram cho CDN — **chưa từng được kiểm chứng bằng traffic CDN thật**. [SPIKE-02](../spikes/README.md#spike-02) đã đóng ở 0/250 lần gặp `CDN_REDIRECT` thật (kênh test quá nhỏ để kích hoạt cơ chế đó), và không có cách nào chủ động kích hoạt `CDN_REDIRECT` để test thêm mà không cố tình tạo tải giả lên hạ tầng Telegram — ngoài phạm vi, cùng lý do đạo đức SPIKE-02 đã nêu khi đóng. Đây là code phòng thủ viết đúng đặc tả, cùng mức độ tin cậy "spec-only, chưa traffic-verified" như các phần khác của dự án chưa có bằng chứng thiết bị/traffic thật — không phải một khẳng định đã hoạt động đúng trên CDN thật.

### Test

`libs/core-download/src/download-engine.spec.ts`: thêm 3 test (AIMD ramp-up chạm trần mặc định 4; flood giảm một nửa + circuit breaker 3-lần-liên-tiếp chặn round-trip kế tiếp không tốn mạng; dedup file-reference-refresh khi nhiều worker cùng gặp lỗi gần như đồng thời) — 9 test trong file, tất cả pass.

`libs/core-mtproto/src/gateway-download.spec.ts` (file mới): 5 test cho CDN — happy path giải mã + xác minh khớp; hash không khớp → `CdnHashMismatchError`; hash không phủ hết dữ liệu → `CdnHashMismatchError`; `CdnFileReuploadNeeded` → reupload trên DC gốc rồi retry thành công; FLOOD_WAIT bắt được luôn ném thẳng (xác nhận phát hiện #floodSleepThreshold ở trên).

## Cập nhật sau khi Accepted (2026-08-28, slice Settings — Màn hình 7)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

Đóng "known gap" ghi ở addendum 2026-08-26 phía trên: "trần mặc định 4 (`opts.maxConcurrency`), chưa có Settings UI để user tự nâng lên 8". Slice Settings (`/settings`, docs/ux-design.md Màn hình 7, khối "Mạng & băng thông") thêm đường điều chỉnh thật, đúng đúng như §3 gốc mô tả ("cho phép user nâng lên 8 trong Cài đặt kèm cảnh báo rõ ràng về rủi ro tài khoản").

**`libs/core-download/src/download-engine.ts`** — thêm `setMaxConcurrency(n)` vào `DownloadEngine`: clamp `n` về `[1, HARD_CEILING_CONCURRENCY]`, và với MỌI `dcState` đang có trong `Map` (không chỉ DC sẽ dùng tiếp theo), hạ `state.concurrency` xuống trần mới NGAY nếu đang cao hơn — hạ trần để né rủi ro phải có tác dụng tức thì, không thể bắt user đợi tới lần FLOOD_WAIT kế tiếp mới thấy `concurrency` giảm (AIMD chỉ tự giảm khi gặp flood, không tự giảm khi trần bị hạ). `DEFAULT_MAX_CONCURRENCY`/`HARD_CEILING_CONCURRENCY` xuất ra khỏi module (trước đó là hằng số nội bộ) để phần còn lại của repo dùng đúng cùng hai con số 4/8, không hardcode rời rạc.

**`libs/worker-host/src/core-worker.ts`** — RPC mới `setMaxConcurrency(n)`: clamp lại về `[DEFAULT_MAX_CONCURRENCY, HARD_CEILING_CONCURRENCY]` = `[4, 8]` (khoảng hẹp hơn `[1,8]` của hàm gốc — §3 chỉ cho phép NÂNG từ mặc định 4 lên tối đa 8, không cho hạ dưới 4 qua UI này), rồi vừa `syncEngine.mutate({op:'settings.set', k:'maxConcurrency', val})` (đồng bộ xuyên thiết bị qua kênh state, ADR-0009) vừa gọi `downloadEngine.setMaxConcurrency()` ngay lập tức — không chờ round-trip đồng bộ xong mới có hiệu lực trên phiên hiện tại. `downloadEngine` là instance sống trong bộ nhớ Core Worker, KHÔNG persist qua lần khởi động worker mới (đóng tab, tải lại trang) — `initSync()` vì vậy được sửa để, ngay sau khi hydrate xong, tự đọc lại `state.settings['maxConcurrency']` và gọi `setMaxConcurrency()` một lần nữa; đây là cách DUY NHẤT giá trị đã lưu từ phiên trước (hoặc đồng bộ từ thiết bị khác) thật sự có hiệu lực ở một Core Worker mới khởi động.

**`apps/web/src/app/settings/settings.ts`** — `MatSlider` phạm vi `[4, 8]` gọi RPC trên. Đọc giá trị hiện tại qua `liveQuery` thẳng trên `SyncState.settings['maxConcurrency']` (đường đọc, ADR-0007) — không qua RPC riêng để hỏi giá trị, cùng quy ước đọc mọi nơi khác trong `apps/web`. **Không** import `DEFAULT_MAX_CONCURRENCY`/`HARD_CEILING_CONCURRENCY` từ `@tsmc/core-download` — CLAUDE.md bất biến #4 cấm `apps/web` import `core-download` trực tiếp (chỉ qua `worker-host`), nên hai số 4/8 bị hardcode lại trong `settings.ts` kèm comment trỏ về đúng §3 này, chấp nhận trùng lặp một cặp hằng số ổn định thay vì mở một đường re-export xuyên boundary.

**Test:** `libs/core-download/src/download-engine.spec.ts` thêm 3 test cho `setMaxConcurrency()` — nâng trần cho phép AIMD ramp cao hơn 4 (dựng đủ 27 lần thành công liên tiếp để concurrency thật sự chạm 8, theo đúng công thức tăng dần của AIMD); clamp `[1, 8]` bất kể giá trị truyền vào; hạ trần áp dụng ngay cho DC đang chạy ở concurrency cao hơn. `libs/core-storage/src/session-store.spec.ts` thêm test cho `wipeAllData()` (dọn IndexedDB lúc đăng xuất — không trực tiếp thuộc §3, nhưng cùng slice Settings, xem docs/ux-design.md Màn hình 7 "Logout Journey").

**Chưa kiểm chứng bằng traffic thật:** khác các addendum SPIKE-04/CDN ở trên, thay đổi này **không có spike riêng** — chỉ có test đơn vị dùng fake gateway (không có FLOOD_WAIT thật xảy ra khi user thật sự kéo slider lên 8 trên tài khoản thật). Rủi ro tài khoản khi dùng trần 8 vẫn là giả thuyết dựa trên lý luận của §3 gốc, không phải số đo — dòng cảnh báo đỏ trong Settings UI phản ánh đúng mức độ chắc chắn này (cảnh báo rủi ro, không phải "đã kiểm chứng an toàn").

`npm run test:libs` (204 test, toàn repo), `npm run lint`, `npx tsc --noEmit` cho từng package đụng tới, `npm run build:worker`/`build:sw`/`build:web` đều pass sau khi triển khai.
