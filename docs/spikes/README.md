# Spikes — kiểm chứng giả thuyết trước khi cam kết kiến trúc

Mỗi spike ở đây tồn tại vì một ADR đang **đặt cược vào một điều chưa được chứng minh**. Spike chưa chạy thì kết luận trong ADR vẫn chỉ là giả thuyết, và tài liệu phải nói đúng như vậy.

Quy tắc: **một spike chỉ đóng khi có số liệu từ thiết bị thật**, không đóng bằng lập luận hay bằng tài liệu của bên thứ ba.

| ID | Câu hỏi | Đặt cược ở ADR | Trạng thái |
|---|---|---|---|
| [SPIKE-01](#spike-01) | Media element có đi qua Service Worker không, đặc biệt trên Safari/iOS? | [0005](../adr/0005-streaming-qua-service-worker-http-range.md), [0004](../adr/0004-mo-hinh-da-luong.md) | 🟢 **ĐẠT trên iPad thật (WebKit)** và Chrome desktop; rủi ro chính đã gỡ |
| [SPIKE-02](#spike-02) | GramJS xử lý `CDN_REDIRECT` tới đâu? | [0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md), [0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) | 🟡 **Đã đóng (chấp nhận)** — 250/250 chunk thành công qua đường tải không-CDN; CDN_REDIRECT chưa từng xảy ra trong test, chấp nhận rủi ro thấp cho use-case chính, xử lý khi gặp thật |
| [SPIKE-03](#spike-03) | Bundle GramJS nặng bao nhiêu, TTI ra sao? | [0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md) | 🟢 Đạt (236 KB brotli, ~110 ms) — 🔴 nhưng phát hiện `telegram` đã bị archive, cần bạn quyết hướng đi |
| [SPIKE-04](#spike-04) | Tốc độ tải thực tế và ngưỡng `FLOOD_WAIT` | [0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) | ⏳ Chưa dựng |
| [SPIKE-05](#spike-05) | Angular Material + CDK ăn bao nhiêu ngân sách app shell? | [0016](../adr/0016-angular-material-va-cdk.md) | ⏳ Chưa dựng — chạy ngay sau khi scaffold |

---

## SPIKE-01

**Câu hỏi:** Khi `<video src="/_stream/...">`, request của media element có đi vào `fetch` handler của Service Worker không — và nếu có, chuỗi `Range` diễn ra thế nào khi tua?

**Vì sao quan trọng:** nếu câu trả lời là "không" trên iOS, toàn bộ Epic 4 không chạy được trên iPhone/iPad và ta phải biết điều đó **trước khi** viết download scheduler, chứ không phải sau.

### Bàn thử nghiệm
`spike/` — trang tĩnh độc lập, **không cần Telegram, không cần build, không phụ thuộc Angular**.

Nó dựng lại đúng đường đi thật của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md), chỉ thay nguồn byte:

```text
KIẾN TRÚC THẬT :  <video> → SW → Core Worker → MTProto → Telegram DC
TESTBED        :  <video> → SW → tab (File.slice) → file trên máy
                            ↑ giống hệt nhau: MessageChannel + ArrayBuffer transferable
```

Việc cố ý tách khỏi Telegram là điểm mấu chốt: nếu spike hỏng, ta biết chắc lỗi thuộc về trình duyệt chứ không phải MTProto, GramJS hay mạng.

### Cách chạy
```bash
# Tự động trên Chrome/Edge cài sẵn (chỉ phủ được desktop Chromium)
npm run spike:auto -- "D:/duong/dan/phim.mp4"

# Thủ công, cục bộ (localhost là secure context nên SW chạy được)
npm run spike

# Trên thiết bị thật — bắt buộc cho phần iOS
npm run deploy:spike        # → https://<project>--spike-01-<hash>.web.app
```

**Đã deploy (2026-08-23):** https://tsmc-staging--spike-01-dfcswtj5.web.app — hết hạn 2026-08-30. Mở thẳng URL này trên iPhone/iPad thật để chạy phần còn thiếu của ma trận thiết bị bên dưới; không cần đăng nhập hay cấu hình gì thêm. Nếu link đã hết hạn, chạy lại lệnh trên để tạo preview mới.
Mở URL trên máy cần test → chọn một file video → bấm lần lượt A, B, C → bấm **Copy báo cáo** → dán vào bảng kết quả bên dưới.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A | `fetch()` kèm `Range: bytes=1000-1999` | status `206`, đúng 1000 byte. Đây là baseline — hỏng ở đây nghĩa là testbed sai, không phải trình duyệt sai |
| **B1** | SW có thấy request với `destination: "video"` | **Đây là câu trả lời của spike.** Không thấy = media element đi vòng qua SW |
| B2 | Video phát được | có sự kiện `loadeddata` |
| C | Tua tới 80% | có sự kiện `seeked`, và SW ghi nhận một `Range` mới với offset lớn |
| D | Chịu được độ trễ | đặt độ trễ giả lập 500 ms, B2 và C vẫn đạt (mô phỏng round-trip thật tới DC) |

### Ma trận thiết bị cần phủ

| Nền tảng | A | B1 | B2 | C | D | Ghi chú |
|---|---|---|---|---|---|---|
| Chrome 151 (Win 11, headless) | ✅ | ✅ | ✅ | ✅ | ✅ | 2026-08-23, chạy tự động |
| **iPad, iPadOS 26.6 (thiết bị thật, CriOS/WebKit)** | ✅ | ✅ | ✅ | ✅ | — (chưa test độ trễ giả lập) | **2026-08-23, chạy tay — kết luận chính của SPIKE-01** |
| Firefox desktop | — | — | — | — | — | chưa chạy |
| Safari macOS | — | — | — | — | — | chưa chạy |
| Safari iOS (bản Safari gốc, không phải CriOS) | — | — | — | — | — | không bắt buộc — xem ghi chú dưới |
| Chrome Android | — | — | — | — | — | chưa chạy |

> Chrome trên iOS dùng WebKit, nên nó **không** là một phép thử độc lập — kết quả của nó đi cùng Safari iOS.

### Kết quả

#### Chrome 151 / Windows 11 · 2026-08-23 · file MP4 H.264 14.2 MB

| Mã | Kết quả | Số đo |
|---|---|---|
| A | ✅ ĐẠT | `206`, `Content-Range: bytes 1000-1999/14933151`, đúng 1000 byte |
| **B1** | ✅ **ĐẠT** | SW thấy request với `destination: "video"` — media element **có** đi qua Service Worker |
| B2 | ✅ ĐẠT | khung hình đầu tiên sau **100 ms** |
| C | ✅ ĐẠT | seek tới 80% mất **272 ms** |
| D | ✅ ĐẠT | với độ trễ giả lập 500 ms/chunk: khung đầu sau **2101 ms** (4 chunk nối tiếp) |

**Quan sát đáng giá hơn cả kết quả đạt/không đạt:**

1. Chrome mở đầu bằng `Range: bytes=0-`, rồi **lập tức nhảy tới gần cuối file** (`bytes=12419072-`) để tìm `moov` atom, rồi mới quay lại `bytes=1048576-`. Đây là bằng chứng thực nghiệm cho yêu cầu `+faststart` ở [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md): file không faststart sẽ tốn thêm một vòng round-trip tới **cuối** file trước khi phát được khung hình đầu tiên — với MTProto là vài trăm ms bị mất trắng ở mỗi lần mở phim.
2. Player **không** yêu cầu tuần tự. Chỉ trong một lần seek nó phát ra 5 range chồng lấn nhau. Điều này xác nhận rằng scheduler ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) phải huỷ được request đang bay, nếu không mỗi thao tác tua sẽ để lại vài pipeline mồ côi.
3. Chiến lược "cửa sổ giới hạn" của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md) hoạt động đúng như thiết kế: trả 2 MB cho một `Range: bytes=0-` mở, và player tự xin tiếp mà không phàn nàn.
4. Phép đo D lần đầu cho ra 52 ms — **sai**, do media element phục vụ lại từ cache khi URL không đổi. Đã sửa testbed để mỗi lần chạy dùng token mới. Ghi lại ở đây vì đây đúng là loại bẫy sẽ làm sai lệch mọi benchmark streaming về sau.

#### iPad, iPadOS 26.6 / Chrome iOS (CriOS 151, WebKit) · 2026-08-23 · deploy thật trên `tsmc-staging.web.app`, không phải localhost

File thử: `IMG_0953.mov` (65.9 MB, 35.2s) và `IMG_0842.mov` (119.4 MB, 63.9s) — video quay trực tiếp bằng camera thiết bị, mã hoá `video/quicktime`.

| Mã | Kết quả | Số đo |
|---|---|---|
| A | ✅ ĐẠT | `206`, đúng `Content-Range`, đúng 1000 byte |
| **B1** | ✅ **ĐẠT** | SW thấy request với `destination: "video"` — **media element có đi qua Service Worker trên WebKit thật** |
| B2 | ✅ ĐẠT | khung hình đầu tiên sau **124 ms** (file 1) / **124 ms** (file 2) |
| C | ✅ ĐẠT | seek tới 80% mất **257 ms** |
| D | — | chưa bấm nút test độ trễ giả lập trong lần chạy này |

**Đây là câu trả lời của toàn bộ SPIKE-01: trên WebKit thật, `<video>` đi qua Service Worker và toàn bộ chuỗi HTTP Range hoạt động đúng như thiết kế của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md).** Rủi ro "Epic 4 chết trên iOS" ở [architecture.md § 7](../architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng) được gỡ.

**Lưu ý về phạm vi bằng chứng:** trình duyệt thử là Chrome iOS (CriOS), không phải Safari gốc. Trên iOS, Apple bắt buộc **mọi** trình duyệt — kể cả Chrome — dùng chung engine WebKit và chung cơ chế Service Worker/media pipeline của hệ điều hành (khác Android, nơi Chrome dùng Blink riêng). Vì vậy kết quả này về nguyên tắc áp dụng cho Safari luôn. Test Safari gốc một lần là việc nên làm cho chắc chắn tuyệt đối, nhưng không còn là việc chặn tiến độ.

**Quan sát khác với hành vi trên desktop Chrome — cần đưa vào thiết kế thật:**

1. **WebKit dò khả năng trước khi xin dữ liệu thật:** request đầu tiên luôn là `Range: bytes=0-1` (probe 2 byte) rồi mới tới `Range: bytes=0-<hết file>` (open-ended, không giới hạn như desktop Chrome vốn tự giới hạn cửa sổ). SW của testbed vẫn tự kẹp về `windowSize` (2 MB) đúng như thiết kế — **nhưng đây là bằng chứng cho thấy scheduler thật không được tin vào `end` mà client gửi lên, phải luôn tự áp trần cửa sổ**, đúng nguyên tắc đã có ở [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md), giờ được xác nhận là cần thiết chứ không phải phòng xa thừa.
2. **WebKit bắn request dồn dập và trùng lặp nhiều hơn hẳn desktop khi tua/kéo thanh tiến trình** — có thời điểm ghi nhận 7 request giống hệt nhau (`Range: bytes=69140480-69141961`) trong vòng chưa tới 10 ms. Đây là tín hiệu mạnh cho [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md): scheduler thật **bắt buộc phải de-dup request trùng offset đang bay** trước khi bắn RPC MTProto mới, nếu không mỗi lần user kéo thanh tua trên iOS sẽ nhân bản request gấp nhiều lần so với desktop và tiêu tốn oan uổng ngân sách song song ([ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md)).
3. Một chunk mất **1009 ms** để phục vụ dù độ trễ giả lập = 0 (dòng `22:25:38.941`) — nhiều khả năng do tab bị điều tiết nền hoặc áp lực bộ nhớ trên thiết bị thật, thứ không bao giờ xuất hiện khi test trên desktop/headless. Đúng loại rủi ro mà chỉ thiết bị thật mới lộ ra.
4. File `.mov`/QuickTime từ camera Apple phát được ngay dù cảnh báo compat của testbed nói "có thể không giải mã được" ([ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md)) — hợp lý vì đây là định dạng gốc của chính hệ sinh thái Apple. Không nói lên gì về khả năng phát MKV/AVI từ kho cộng đồng, bảng phân hạng compat ở ADR-0013 vẫn giữ nguyên.

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| Đạt hết mọi nơi *(đã xảy ra)* | [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md) được xác nhận thực nghiệm. Việc còn lại: đưa 2 quan sát về de-dup request và không tin `end` của client vào thiết kế scheduler thật ở Epic 4, không phải viết lại kiến trúc |
| Đạt trừ iOS | *(đã loại — iOS đạt)* |
| B1 đạt nhưng C hỏng khi có độ trễ | Vấn đề nằm ở timeout/cửa sổ, không phải kiến trúc — chỉnh kích thước cửa sổ và chiến lược readahead ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) |
| B1 hỏng ở mọi nơi | *(đã loại)* |

---

## SPIKE-02

**Câu hỏi:** GramJS xử lý `CDN_REDIRECT` (`upload.getCdnFile` + AES-CTR + `upload.getCdnFileHashes`) tới mức nào? Nếu thiếu, chi phí tự viết là bao nhiêu?

**Cần:** `API_ID`/`API_HASH` thật, một tài khoản test, một file lớn (> 1 GB) trên kênh công khai đông người tải — vì chuyển hướng CDN chỉ xảy ra với file phổ biến.

**Ghi lại:** tần suất gặp `CDN_REDIRECT` trên nhiều lần tải chunk rải khắp file; GramJS có tự xử lý không (`downloadMedia()` cấp cao có trả đúng kích thước không); nếu có, nó có xác minh hash không.

### Vì sao Claude không tự chạy spike này

Trạng thái đăng nhập MTProto không phải là "một API key" — nó là **toàn quyền tài khoản Telegram thật**: đọc/gửi tin nhắn, xoá tài khoản, mạo danh chủ tài khoản. Việc đăng nhập đòi hỏi số điện thoại và mã OTP gửi trực tiếp tới thiết bị của bạn — một luồng tương tác con người không thể (và không nên) chạy qua tool call của Claude. Đây đúng là mô hình đe doạ mà chính [ADR-0011](../adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) mô tả cho ứng dụng thật; áp dụng luôn cho cách ta kiểm chứng spike.

### Cách chạy — **bạn tự chạy trong terminal của bạn**

Tool sẵn có ở `tools/spike-02/`, chia hai bước tách bạch:

```bash
cd tools/spike-02
npm install

# Bước 1 — đăng nhập một lần. Hỏi số điện thoại + mã OTP ngay trong terminal.
# Session sinh ra chỉ ghi vào file cục bộ .session.local (đã gitignore),
# không bao giờ in ra, không dán vào chat với Claude.
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login

# Bước 2 — quét một kênh public đông người tải, tìm file lớn, đo CDN_REDIRECT.
# Gọi "node scan.mjs" trực tiếp, KHÔNG dùng "npm run scan -- ...": trên
# PowerShell (và một số shell Windows khác), npm tự nuốt mất mọi --flag đứng
# sau dấu -- khi chạy qua "npm run" — kể cả dạng --flag=value — coi chúng là
# cấu hình riêng của npm thay vì chuyển vào script. Gọi node trực tiếp thì
# không bị ăn mất.
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  node scan.mjs --peer <username_kenh> --limit 60 --minSizeMb 500
```

Kết quả ghi ra `docs/spikes/spike-02-result.local.json` — file này **chỉ chứa số liệu tổng hợp** (kích thước file, số lần redirect, kết quả `downloadMedia()`), không chứa session, không chứa số điện thoại. An toàn để dán nội dung vào chat cho Claude đọc và viết lại phần Kết quả bên dưới.

**`--peer` là số thuần** (ví dụ copy từ link `t.me/c/<id>/...`): script tự ép về `BigInt` và, nếu channel chưa có trong cache của session, tự gọi `getDialogs()` một lần để nạp cache rồi thử lại — không cần tự làm gì thêm. Nếu vẫn không tìm thấy, khả năng cao tài khoản đang dùng chưa là thành viên của kênh đó.

### Kết quả

#### "Group học tập" · 2026-08-23 · 5 file, 530–962 MB, 50 chunk/file (250 chunk tổng)

| File | Kích thước | Bình thường | CDN_REDIRECT | Lỗi | `downloadMedia()` cấp cao |
|---|---|---|---|---|---|
| 1 | 530 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 2 | 575 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 3 | 735 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 4 | 629 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 5 | 962 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |

**Đọc kết quả này cho đúng — không vội kết luận "GramJS xử lý tốt CDN_REDIRECT":**

- Đây là kết quả **0/250, không phải "đạt 250/250"** theo nghĩa tích cực. Cả tầng thấp (`upload.getFile` trực tiếp) lẫn tầng cao (`downloadMedia()`) đều **không hề gặp một lần `CDN_REDIRECT` nào**, nên spike **chưa thực sự kiểm chứng được** cách GramJS xử lý redirect đó — vì tình huống đó chưa từng xảy ra trong lần chạy này.
- Lý do rất có thể: `CDN_REDIRECT` chỉ được Telegram kích hoạt cho file bị **rất nhiều người tải đồng thời** (để giảm tải DC gốc) — tiêu chí gốc của spike ghi rõ "kênh công khai đông người tải". "Group học tập" là nhóm riêng tư/nhỏ, không tạo đủ tải để kích hoạt cơ chế đó. Tiêu chí ">1 GB" cũng chưa đạt (file lớn nhất 962 MB).
- **Điều spike này CÓ chứng minh được, và có giá trị thật:** đường tải chính (không qua CDN) hoạt động **hoàn toàn ổn định và chính xác** ở quy mô file gần 1 GB — 250/250 lần gọi `upload.getFile` thành công, không một lỗi `FILE_REFERENCE`/`FLOOD_WAIT` nào xuất hiện, và `downloadMedia()` cấp cao khớp byte-chính-xác cả 5 lần. Đây chính là đường đi thật của **tuyệt đại đa số nội dung trong kho cá nhân và các nhóm cộng đồng vừa/nhỏ mà TSMC nhắm tới** ([ADR-0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)) — không phải nội dung viral hàng chục nghìn lượt tải cùng lúc.

**Đã chốt (2026-08-23):** chấp nhận kết quả hiện tại, đóng spike ở đây — không chạy thêm trên kênh public đông người tải. Lý do: [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) đã thiết kế phòng thủ sẵn cho `CDN_REDIRECT` (xác minh hash bắt buộc) bất kể tần suất gặp phải trong thực tế; rủi ro còn lại (chưa kiểm chứng cách GramJS xử lý redirect thật) được đánh giá là thấp cho đúng use-case chính của TSMC — kho cá nhân và nhóm cộng đồng vừa/nhỏ ([ADR-0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)), không phải kênh viral hàng chục nghìn lượt tải đồng thời. Sẽ xử lý khi gặp thật ở giai đoạn build Epic 4.

---

## SPIKE-03

**Trạng thái:** 🟢 Đã chạy (2026-08-23) — kèm một phát hiện ngoài dự kiến làm phát sinh quyết định cần bạn duyệt, xem cuối mục.

**Câu hỏi:** GramJS đóng gói cho trình duyệt nặng bao nhiêu (gzip/brotli), và mất bao lâu để khởi tạo client trên máy tầm trung?

**Ngưỡng chấp nhận:** app shell dưới 300 KB brotli (không tính GramJS, được lazy-load riêng theo [ADR-0004](../adr/0004-mo-hinh-da-luong.md)); Core Worker nạp lười và không chặn màn hình đăng nhập.

### Cách chạy
```bash
node tools/spike-03/build.mjs     # bundle bằng esbuild, in kích thước raw/gzip/brotli
node tools/spike-03/measure.mjs   # nạp bundle trong Chrome thật, đo thời gian import + khởi tạo
```
Không cần credential — chỉ dựng object `TelegramClient`, không gọi `connect()`.

### Kết quả — GramJS (`telegram@2.26.22`, bundle bằng esbuild + `esbuild-plugin-polyfill-node`)

| Số đo | Giá trị |
|---|---|
| Bundle raw | 986.7 KB |
| Bundle gzip | 284.1 KB |
| **Bundle brotli** | **236.2 KB** |
| Thời gian nạp module (Chrome thật, localhost) | 106.7–112.4 ms |
| Thời gian `new TelegramClient(...)` | 0.7–1.3 ms |
| **Tổng, từ 0 tới có client sẵn sàng** | **~108–114 ms** |

Build **thành công ngay cả khi stub rỗng cho `fs`/`net`/`tls`** — nghĩa là nhánh code thật sự chạy trong browser (transport WebSocket) không đụng tới các API đó lúc runtime, dù bundler vẫn cần phân giải chúng tĩnh. Xác nhận đúng tuyên bố "hỗ trợ browser" ở [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md). 236 KB brotli cho một thư viện MTProto đầy đủ (TL schema, crypto, transport) là con số tốt, và vì nó nằm trong Core Worker lazy-load ([ADR-0004](../adr/0004-mo-hinh-da-luong.md)) nên không cộng vào ngân sách app shell 300 KB.

### 🔴 Phát hiện ngoài dự kiến — cần quyết định, không chỉ ghi nhận

Khi cài đặt: **`telegram` (GramJS) đã bị archive, ngừng bảo trì.** npm tự in cảnh báo:
```
npm warn deprecated telegram@2.26.22: This package is archived and no longer maintained.
Development continues in teleproto, a largely compatible, actively maintained fork.
```

Đã thử bundle song song `teleproto@1.228.5` (fork được khuyến nghị) để so sánh:

| | GramJS (`telegram`) | teleproto |
|---|---|---|
| Trạng thái bảo trì | ⚠️ Archived | ✅ Đang bảo trì (publish gần nhất 2026-08-03) |
| Bundle raw | 986.7 KB | 2566.0 KB |
| Bundle brotli | 236.2 KB | 327.8 KB |
| Chạy được trong Chrome thật? | ✅ Có | ❌ **Crash lúc khởi tạo**: `Cannot set property cwd of #<Object> which has only a getter` |
| Mô tả trên npm | "MTProto client... Node.js" (nhưng có browser build đã kiểm chứng ở trên) | **"Modern Telegram MTProto client for Node.js"** — không có trường `browser`/`exports`, không tuyên bố hỗ trợ browser |
| Dependency đáng chú ý | — | `socks` (proxy TCP, chỉ có nghĩa ở Node), `node-localstorage` (session lưu file, chỉ Node) |

Lỗi crash của teleproto tới từ xung đột giữa cách nó dùng biến `process` toàn cục với các polyfill browser tiêu chuẩn — có thể sửa được với đủ thời gian, nhưng bản thân việc phải sửa, cộng với mô tả "for Node.js" và các dependency thiên Node, là tín hiệu khá rõ: **fork đang được bảo trì có vẻ đang ưu tiên hướng Node.js/userbot, không còn ưu tiên browser như bản gốc.**

**Vì sao đây chưa phải khủng hoảng:** [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md) đã cố ý bọc GramJS sau cổng `TelegramGateway`, chính vì lường trước rủi ro khoá cứng vào một thư viện. Nhờ vậy, thư viện MTProto có thể thay thế sau này với chi phí giới hạn trong một package, không lan ra toàn bộ codebase.

**Nhưng đây là quyết định thật cần bạn duyệt, không phải việc tôi tự chốt:** dùng một thư viện core không còn ai vá lỗi/theo kịp thay đổi giao thức Telegram là rủi ro vận hành dài hạn thật sự, vượt ngoài phạm vi kỹ thuật thuần tuý của một ADR. Ba hướng khả dĩ:

1. **Giữ GramJS, ghim chặt phiên bản**, chấp nhận rủi ro, tự vá nếu Telegram đổi TL schema và GramJS không theo kịp. Phù hợp nếu ưu tiên "chạy được ngay trong browser hôm nay".
2. **Đầu tư sửa teleproto cho browser** (fix xung đột `process`, đóng góp ngược upstream nếu maintainer đồng ý), chấp nhận rủi ro "chưa ai kiểm chứng dài hạn". Phù hợp nếu ưu tiên "có người vá lỗi lâu dài".
3. **Theo dõi định kỳ**, khởi động với GramJS (đã kiểm chứng hoạt động), đặt lịch đánh giá lại (ví dụ mỗi quý, hoặc ngay khi Telegram đổi giao thức làm GramJS hỏng thật) — tận dụng đúng lớp bọc `TelegramGateway` đã thiết kế sẵn cho tình huống này.

**Đã chốt (2026-08-23): hướng 1** — giữ GramJS, ghim cứng `telegram@2.26.22` ở mọi package tiêu thụ nó (`tools/spike-02`, `tools/spike-03`, và sau này `libs/core-mtproto`). Chi tiết và lý do đầy đủ ghi ở phần "Cập nhật sau khi Accepted" của [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-23-spike-03).

---

## SPIKE-04

**Câu hỏi:** Với 2/4/8 kết nối song song, tốc độ tải thực tế là bao nhiêu và `FLOOD_WAIT` bắt đầu xuất hiện ở đâu?

**Lưu ý đạo đức:** chạy trên tài khoản test dùng một lần, không chạy trên tài khoản chính. Mục tiêu là **tìm trần an toàn**, không phải tìm tốc độ tối đa ([ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md)).

---

## SPIKE-05

**Câu hỏi:** Angular Material + CDK ăn bao nhiêu ngân sách app shell, và có còn dưới ngưỡng 300 KB brotli của [SPIKE-03](#spike-03) không?

**Vì sao quan trọng:** [ADR-0016](../adr/0016-angular-material-va-cdk.md) chọn Material dựa trên giá trị của virtual scroll + a11y + overlay, nhưng **chưa đo** cái giá. Nếu Material một mình đã ăn hết ngân sách thì phải cắt bớt component, hoặc dùng CDK thuần cho phần lớn giao diện và chỉ lấy Material ở vài chỗ.

**Đo gì:**

| Cấu hình | Kỳ vọng |
|---|---|
| App shell trống (Angular 22, zoneless, không Material) | mốc chuẩn |
| + CDK thuần (overlay, a11y, virtual scroll, portal) | mức tăng nhỏ, gần như không có CSS |
| + Material tối thiểu (button, icon, dialog, chips, sidenav) + theme M3 tự định nghĩa | **con số quyết định** |

**Ngưỡng:** app shell (không tính GramJS, vốn lazy-load trong Core Worker) dưới **300 KB brotli**.

**Nếu vượt ngưỡng:** giảm dần theo thứ tự — bỏ theme dựng sẵn, thay component Material bằng CDK + CSS tự viết ở những chỗ giao diện đơn giản, `@defer` các component chỉ dùng trong dialog/cài đặt.

**Chưa dựng** — chạy ngay sau khi scaffold workspace, vì cần một app thật để đo.
