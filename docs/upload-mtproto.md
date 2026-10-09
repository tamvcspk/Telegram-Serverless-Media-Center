# Kiến thức upload MTProto cho ingest desktop

> **Cách dùng tài liệu này:** tài liệu THAM KHẢO để cải thiện đường upload của `apps/tsmc-ingest-desktop` (`ingest-grammers`). Nó không phải ADR — không ràng buộc. Số đo trong đây **không phải của TSMC**: nguồn là dự án khác (`tgmirror`, Python + Telethon, spike 2026-09-20 → 2026-09-23), đo trên **một tài khoản, một đường truyền nhà ~250 Mbps, máy Windows**. Telegram không công bố giới hạn nên coi là điểm khởi đầu để **đo lại bằng spike của TSMC**, không phải hằng số. Trạng thái hiện tại của code → [roadmap](./roadmap.md); quyết định chọn grammers → [ADR-0017](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md).
>
> **Cách cập nhật:** khi một spike/slice upload cho số liệu thật của TSMC, ghi vào §7 (đánh dấu nguồn: tgmirror hay TSMC), không sửa lặng lẽ bảng §3.

## 1. Tóm tắt (đọc cái này nếu vội)

1. File ≥ **10 MB** dùng `upload.saveBigFilePart`; nhỏ hơn dùng `upload.saveFilePart`.
2. Part upload **tối đa 512 KiB**; part download **tối đa 1 MiB**, không vắt qua ranh giới 1 MiB.
3. Big file tối đa **4000 part** (~2 GB) cho tài khoản thường. Premium cao hơn — TSMC đã đo thật ở [SPIKE-10 M7](./spikes/README.md#spike-10) (xem `MAX_UPLOAD_BYTES_*` trong `ingest-grammers`).
4. Part gửi **song song, thứ tự bất kỳ**; chỉ cần `file_part` + `file_total_parts` đúng và cùng một `file_id` ngẫu nhiên 64-bit.
5. File đã upload mà không dùng trong tin nhắn thì Telegram tự bỏ → lỗi giữa chừng không để lại rác.
6. **Một kết nối dù nhiều request đang bay vẫn chậm** (~3 MB/s lên). Muốn nhanh phải **nhiều kết nối**, mỗi kết nối **1 request đang bay**.
7. Cấu hình tốt nhất đã đo (tái lập 2 lần): **8 kết nối × 1 request, một file một lúc → 24–28 MB/s**.
8. **Vượt 8 là vỡ** (HTTP 429 ở tầng transport, hoặc server đóng kết nối/treo) — cả vượt số request lẫn số kết nối.
9. **Không chạy upload và download cùng lúc**, **không đẩy nhiều file song song** qua cùng bộ kết nối.
10. 429 transport xử lý như FloodWait (chờ ~60 s, giảm ngân sách), **không retry tại chỗ**.

## 2. Giao thức

### 2.1 Upload một file lớn

```
file_id = random i64
parts   = ceil(size / 512 KiB)          // phải <= giới hạn của tài khoản
for index in 0..parts (song song, thứ tự bất kỳ):
    upload.saveBigFilePart(file_id, file_part=index, file_total_parts=parts, bytes=<=512 KiB>)
        -> Bool  (false => coi là lỗi part)
handle = InputFileBig { id: file_id, parts, name }
```

Sau đó mới **đăng** bằng một request ghi riêng, dùng `handle` làm `file` của `InputMediaUploadedDocument`. Mọi part trừ part cuối đúng 512 KiB. File < 10 MB: `saveFilePart` + `InputFile` (có `md5_checksum`), pool không có lợi.

### 2.2 Đăng media — sai ở đây thì video thành "file" trơn

- Video/audio… phải gửi **kèm `attributes`** (`DocumentAttributeVideo`…) và `mime_type`. Bật `force_file` cho video là Telegram hiển thị thành file bất kể attributes (lỗi thật đã gặp ở nguồn). Ghi chú: grammers không có `forceDocument`, `InputMessage::document` đã đủ ngữ nghĩa — xem doc đầu `rpc.rs`.
- Video: `nosound_video = true` (không thì video không track âm thanh bị biến thành GIF), `supports_streaming = true`.
- Ảnh bìa: upload riêng (nhỏ, đường thường), gắn vào `InputMediaUploadedDocument.thumb`.
- Caption + entities: entity offset/length tính theo **UTF-16 code unit** (Rust: `encode_utf16`, không dùng chỉ số byte/char).

### 2.3 Album (grouped media) — TSMC hiện không dùng, ghi để khỏi tra lại

- Mỗi thành viên: upload bytes → `messages.uploadMedia(peer, media)` → media tham chiếu. `messages.sendMultiMedia` **từ chối** `InputMediaUploadedDocument/Photo` trần (`MediaInvalidError`).
- Một `sendMultiMedia` với `InputSingleMedia(media, message, entities)`; map id về bằng `random_id` trong `UpdateMessageID`. Không tách album qua nhiều lần đăng.

### 2.4 Topic (forum)

`reply_to = InputReplyToMessage { reply_to_msg_id: topic_id, top_msg_id: topic_id }`.

### 2.5 Gửi lại bằng tham chiếu file (không tốn băng thông)

`InputMediaDocument(id, access_hash, file_reference)` chạy được khi nguồn cho forward. Nguồn `noforwards` → `CHAT_FORWARDS_RESTRICTED`. `FILE_REFERENCE_EXPIRED`: lấy lại message để có reference mới rồi thử lại **đúng một lần**. (Bất biến #5: TSMC chỉ ghi vào kênh của chính admin; mục này chỉ liên quan nếu sau này có tính năng chuyển kênh.)

## 3. Mô hình tốc độ đã đo (nguồn tgmirror)

### 3.1 Upload dữ liệu rác, big file, 1 file

| Kết nối × request tổng | Kết quả |
|---|---|
| 1 × 8 | nhanh 10 s đầu (~7.7), rồi **2–3 MB/s** suốt ≈ tốc độ 1 request/lần |
| 2 × 8 | 18 MB/s ở 384 MB; 1500 MB: 10 → 7 → 3.5 MB/s (**tụt theo thời gian**) |
| 4 × 8 | 27.6 MB/s ở 384 MB; 1500 MB: 13 → 7 → 8 MB/s |
| 4 × 4 / 4 × 8 / 4 × 16 | 9.7 / 12.6 / 19.9 MB/s, luôn sạch |
| **8 × 8** | **24.3 → 27.75 MB/s, 1500 MB xong ~60 s, không 429** (hai lần độc lập) |
| 8 × 16 | **vỡ** (429 + timeout) |
| 16 × 16 | **vỡ** (timeout, không 429) |

Đối chứng: Telegram Desktop cùng tài khoản ~31 MB/s ổn định. CPU client không phải nút cổ chai (0–7%). Download: 1 kết nối + 4–8 request bay → 25–30 MB/s; một request một lúc ~4 MB/s.

### 3.2 "Tụt theo thời gian"

Ít kết nối (1–2): burst nhanh rồi tụt 2–4× trong ~60 s (~2 MB/s mỗi kết nối sau burst). 8 kết nối tụt nhẹ (~30%). Giả thuyết: giới hạn theo kết nối/phiên có burst đầu. **Bài học: muốn ổn định, tăng số kết nối chứ đừng tăng số request trên mỗi kết nối.**

### 3.3 Cấu hình đã vỡ — đừng lặp lại

| Cấu hình | Triệu chứng |
|---|---|
| Upload 8 kết nối + download 8 request cùng lúc | `invalid buffer ... HTTP code 429` lặp, upload timeout 90 s |
| Upload 4 kết nối + download cùng lúc | 429 transport ở lần lặp 2 |
| Upload 6 kết nối + download cùng lúc | upload **treo**, server đóng kết nối (`0 bytes read on a total of 8 expected bytes`) — nặng hơn 429, im lặng |
| Upload 2 kết nối + download cùng lúc | chạy hết nhưng nhiều lỗi tự hồi phục (`invalid checksum`, `wrong session ID`), 16.6 MB/s |
| 2–8 file song song qua 2 kết nối dùng chung | download vỡ gần mọi ô; upload vỡ ở 8 file |
| 8 file song song, mỗi file kết nối riêng (16 kết nối) | từng "sạch 32.8 MB/s" nhưng do hình dạng spike sai (mở kết nối mới mỗi lượt); không phản ánh sản xuất |
| Download 8 request bay (video thật) | 429 liên tục. Hạ xuống 4 thì hết |

Quy tắc: **chỗ vỡ nằm ở số kết nối mở đồng thời ở cả hai chiều, không chỉ tổng request.** Giả thuyết "trần theo tổng request đang bay" đã bị bác bằng số quét 2/4/6.

### 3.4 Cấu hình khuyến nghị

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| Part upload | 512 KiB | cứng |
| Kết nối upload | **8**, mở **một lần**, giữ cho các file kế tiếp | tới DC nhà, cùng auth key |
| Request bay/kết nối | **1** (tổng 8) | không vượt |
| Kết nối download | 1 riêng | không dùng chung với kết nối điều khiển |
| Request download bay | **4** (bắt đầu 2, tăng dần) | 8 từng vỡ |
| File đồng thời | **1** | tải xong → upload xong → file kế |
| Download song song upload | **không** | tuần tự nghiêm ngặt |
| Ngưỡng dùng pool | ≥ 10 MB | nhỏ hơn: đường đơn giản |
| Timeout 1 request | 30 s | không trả lời = coi như bị pushback |

## 4. Xử lý lỗi và backpressure

### 4.1 Ngân sách request kiểu AIMD

- `limit` bắt đầu nhỏ (2), tối đa `maximum`. Cứ **32 part liền** không bị pushback và **không trong 30 s** sau pushback gần nhất → `limit += 1`. Bị pushback → `limit = max(1, limit/2)`, đóng băng tăng 30 s, **log cảnh báo** (một lần truyền bỗng chậm gấp nhiều lần thường là ngân sách đã tụt về 1 — phải thấy được).
- Slot có **ưu tiên** (số nhỏ đi trước).
- Ngân sách **riêng cho mỗi chiều** (up/down): hai chiều vỡ ở ngưỡng khác nhau.

### 4.2 Bộ lập lịch part (`run_parts`)

- N worker cùng lấy part kế tiếp từ **một iterator dùng chung** (khác chia tĩnh round-robin: kết nối chậm tự làm ít part hơn, mỗi part đúng một lần).
- Pushback "mềm" (kết nối đóng, không trả lời 30 s, độ dài sai): giảm ngân sách, **thử lại chính part đó** sau `1s × 2^n × jitter(0.75–1.25)`, **tối đa 5 lần** rồi báo `Transient`.
- **HTTP 429 tầng transport**: *không* retry tại chỗ (đã đo: retry trong 15 s chỉ làm hỏng cả lần chạy). Kết thúc cả lần truyền bằng `FloodWait(60 s, transport=true)`; tầng trên ghi log, tăng delay, chờ, rồi lặp lại cả lần upload. **60 s là ước đoán, chưa đo.**
- `FLOOD_WAIT` thật: giảm ngân sách và dừng ngay cả lần truyền; hủy mọi worker còn lại trước khi trả lỗi.
- Lỗi khác: hủy worker, trả lỗi.

### 4.3 Map lỗi MTProto

| Lỗi | Xử lý |
|---|---|
| `FLOOD_WAIT_X`, `SLOWMODE_WAIT_X` | chờ X giây (SlowMode log riêng) |
| `PEER_FLOOD` | dừng, cảnh báo tài khoản |
| `FILE_REFERENCE_EXPIRED` | lấy lại message, thử lại 1 lần |
| `CHAT_FORWARDS_RESTRICTED` | nguồn bị cấm lưu/forward |
| `CHAT_WRITE_FORBIDDEN`, `CHAT_ADMIN_REQUIRED`, `CHANNEL_PRIVATE`, `USER_BANNED_IN_CHANNEL` | không có quyền |
| `MEDIA_CAPTION_TOO_LONG`, `MESSAGE_TOO_LONG` | lỗi riêng tin đó |
| `MESSAGE_ID_INVALID` | tin nguồn đã mất |
| ConnectionError / Timeout / `SERVER_ERROR` | tạm thời, thử lại |
| `saveBigFilePart` trả `false` | lỗi part |

Thư viện không được tự ngủ FloodWait ngầm — mọi FloodWait phải nổi lên cho limiter của mình (nguồn dùng `flood_sleep_threshold = 0`). **Cần kiểm tra grammers** (`InitParams`/`flood_sleep_threshold`) vì CLAUDE.md đòi tôn trọng `FLOOD_WAIT` tuyệt đối và hiển thị đếm ngược; các RPC chạy qua `Sender::invoke` thô thì không có sleep nào của thư viện.

### 4.4 Tạo kết nối: phải *nói ra* khi thiếu

Chỉ tạo được 1/8 kết nối (hoặc không cái nào, rơi về kết nối chính) → upload chậm hẳn (~3 MB/s). Nguồn từng lùi **âm thầm** và mất nhiều ngày truy nguyên nhân. Log cảnh báo ngay khi số kết nối thực tế < số xin, kèm lý do.

### 4.5 Dữ liệu lớn không đi chung kết nối chính

Download + upload cùng kết nối chính với các lời gọi đọc/đăng → 429. Kết nối truyền file luôn **riêng**.

### 4.6 Download từ DC khác DC nhà

Dùng exported sender (xuất auth sang DC kia). Nghi (chưa chắc) mở nhiều exported sender cùng lúc bị soi khác sender thường.

## 5. Nhịp đăng (pace)

- Telegram giới hạn **tần suất đăng tin**, không phải việc đẩy byte. Đẩy byte **trước**, rồi mới pace, rồi đăng.
- Pace trừ "credit" = thời gian đã mất để đẩy byte: `wait = max(delay × jitter − credit, 0)`; khoảng cách giữa hai lần đăng vẫn ≥ `delay`.
- Mặc định bảo thủ của nguồn (tự chọn, **không phải giới hạn công bố**): ~2 s (jitter ±30%), nghỉ 30–90 s mỗi 200 tin, 5000 tin/ngày/tài khoản. AIMD với delay: FloodWait → tăng delay.
- Với file nhỏ, nút cổ chai là pace chứ không phải tốc độ truyền. Với video lớn của TSMC (mỗi file mất phút), pace gần như không đáng kể; quan trọng với **poster/phụ đề** nhỏ và loạt `publish_catalog` (3 RPC liên tiếp: send → pin → delete).
- Thứ tự ghi: đẩy byte → pace(credit) → đăng. Crash giữa đẩy byte để lại **không có gì**.

## 6. Download (nếu app cần đọc media)

- `upload.getFile(location, offset, limit)` với `limit = 1 MiB`, offset bội của 1 MiB. `upload.FileCdnRedirect` → pool không xử lý được, lùi về đường thường.
- Kiểm độ dài part trả về = `min(1 MiB, size − offset)`; sai thì coi là pushback.
- Ghi từng part đúng vị trí vào file `.part`, **nhớ tập part đã xong** để nhặt tiếp sau flood/mất kết nối; xong thì đổi tên atomic.
- **Upload của nguồn chưa nhớ part đã xong** — mỗi lần thử lại đẩy lại từ đầu. Đây là chỗ TSMC có thể làm tốt hơn, nhưng chưa biết `file_id` đã đẩy sống bao lâu trước khi Telegram bỏ (đo ở [§7b](#7b-điều-chưa-biết--đừng-tin-như-chân-lý)).

## 7. Số đo của TSMC (nguồn: TSMC, `upload_bench.rs`)

Đo 2026-10-09 → 10-10 bằng `apps/tsmc-ingest-desktop/ingest-grammers/examples/upload_bench.rs` (grammers 0.10.0, `saveBigFilePart` thẳng rồi bỏ — không đăng gì), một tài khoản, máy Windows, file thật 1–9 GB đọc từ ổ D:. Mỗi ô đẩy N MB đầu của một file. Đây là số **của TSMC**, tách khỏi bảng §3 (nguồn tgmirror).

| Cấu hình | MB (mỗi ô) | MB/s (vòng 1 / vòng 2) | Ghi chú |
|---|---|---|---|
| static:3 (code cũ) | 512 | 3.7 / 2.0 | tụt còn ~1.5–2.5 MB/s sau ~20 s |
| shared:3 | 512 | 6.7 / 3.4 | iterator chung ≈ 1.8× static cùng số kết nối |
| shared:4 | 512 | 7.9 / 10.2 | tụt sau ~20 s |
| shared:6 | 512 | 23.0 / 21.8 | |
| shared:8 | 512 | 29.7 / 27.2 | |
| shared:6 | 1500 | 4.9 | **lần chạy chậm bất thường** (xem dưới) |
| shared:8 | 1500 | 6.4 | cùng lần chạy chậm |
| **shared:8** | **1000** | **25.5 / 23.9** | cửa sổ 10 s đều 20–27 MB/s, không tụt |
| shared:8@128 (xoay kết nối) | 1000 | 19.0 / 18.2 | mất 19 s mở lại kết nối, không có giai đoạn nhanh mới |
| shared:8@256 | 1000 | 22.0 / 21.4 | mất ~10 s mở lại kết nối |

- **8 kết nối × 1 request + iterator chung giữ ~24–25 MB/s ổn định** (≈ Telegram Desktop ~31 MB/s), nhanh ~8× cấu hình cũ (3 kết nối chia tĩnh). Không gặp 429/`FLOOD_WAIT` ở ô nào. Đã áp vào `multi_connection_upload` (`N_CONNS = 8`, iterator chung).
- **Xoay kết nối không giúp** — thêm chi phí mở lại, không thấy kết nối mới nhanh hơn. Bỏ hướng này.
- **Lần chạy 1500 MB chậm (4.9 / 6.4 MB/s) chưa rõ nguyên nhân**: tài khoản đã đẩy ~8 GB trong ngày, hoặc mạng/đường truyền lúc đó. Lần đo 1000 MB sau đó ở cùng cấu hình lại 24–25 MB/s. Nghĩa là tốc độ có thể tụt mạnh theo điều kiện ngoài tầm kiểm soát — vì vậy cần log tốc độ thật khi upload và AIMD (§4.1) hơn là tin một con số.
- **Chưa đo:** file ≥ 2 GB liên tục với 8 kết nối (thời gian đo mới ~40 s); ô 6 kết nối với 1000 MB; ảnh hưởng của dung lượng đã đẩy trong ngày.

## 7b. Điều CHƯA biết — đừng tin như chân lý

- File ≥ vài GB với 8 kết nối: có tụt tiếp không (spike nguồn chỉ 1500 MB).
- `InputFileBig` đã đẩy có hết hạn khi chờ pace/FloodWait dài không, sau bao lâu. (Quyết định có làm "resume upload" hay không phụ thuộc cái này.)
- Hiển thị đúng "video, streaming, có ảnh bìa" khi dùng `InputFileBig` từ pool: nguồn xác nhận cho video tin đơn; TSMC cũng đã verify upload video thật qua `multi_connection_upload`.
- Thời gian nghỉ 60 s sau 429 transport là ước đoán.
- 16 kết nối vỡ vì quá nhiều kết nối hay vì phiên đo đã mở cả trăm kết nối trong ngày — chưa tách được.
- Số đo là một tài khoản/một mạng. Mọi con số phải nằm trong **config chỉnh được**; log mỗi lần pushback (loại, giây chờ) để chỉnh từ dữ liệu thật.

## 8. So với `ingest-grammers` hiện tại

Đối chiếu với `GrammersIngestRpc::multi_connection_upload` (`apps/tsmc-ingest-desktop/ingest-grammers/src/rpc.rs`), đọc 2026-10-06:

| Hạng mục | Hiện tại | Kiến thức trên gợi ý |
|---|---|---|
| Số kết nối | `N_CONNS = 8` (đổi 2026-10-10 theo §7), mở mới mỗi file, đóng sau file | 8, mở một lần, giữ cho file kế |
| Request bay/kết nối | 1 (đúng) | 1 (đúng) |
| Chia part | iterator dùng chung `AtomicI32` (đổi 2026-10-10) — worker rảnh lấy part kế | cùng |
| Lỗi 1 part | retry 5xx có backoff mũ + jitter, tối đa 5 lần; lỗi khác hủy cả file | thêm phân loại 429 transport / timeout 30 s |
| 429 transport | không phân biệt, lỗi chung `Other` | map riêng, kết thúc lần truyền, chờ ~60 s, lặp |
| `FLOOD_WAIT` | `to_rpc_error` → tầng Angular `withFloodWaitRetry()` đếm ngược | giữ; thêm giảm ngân sách |
| Ngân sách AIMD | không có | có, log khi giảm |
| Timeout request | không thấy | 30 s |
| Thiếu kết nối | `connect_with_auth` lỗi → hủy cả upload | log cảnh báo / lùi có kiểm soát, không im lặng |
| Đọc part | mỗi worker mở một `File`, `seek` + `read_exact` | giữ được (OS cache) — không phải nút cổ chai |
| Số part | `i32::try_from` | chặn theo giới hạn tài khoản (đã có `max_upload_bytes`) |

Phần thừa kế sẵn đúng: part 512 KiB, `SaveBigFilePart` thẳng trên kết nối RAW riêng (không dùng chung kết nối điều khiển), tái dùng `auth_key`, một file một lúc (queue Angular xử lý tuần tự), upload video đi sau remux (không chồng lên download).

## 9. Hướng cải thiện đề xuất (chưa làm — cần quyết định phạm vi)

Thứ tự theo rủi ro tăng dần; mỗi bước verify riêng bằng tài khoản thật (CLAUDE.md: không chạy MTProto hộ người dùng — viết script cho họ chạy).

1. **Spike đo của TSMC** (`scripts/` hoặc example `ingest-grammers/examples/`, ghi `*.local.json` chỉ số tổng hợp): upload dữ liệu rác big file không bao giờ đăng (Telegram tự bỏ, không hiện ở chat nào), quét 3/4/6/8 kết nối × 1 request, 1 file. Đây là cách đo an toàn nhất (nguồn: `scripts/spike_throughput.py`). Kết quả quyết định `N_CONNS`. Cần mở dòng trong [spikes/README.md](./spikes/README.md) theo skill `/spike` nếu muốn ghi như spike chính thức.
2. **Iterator part dùng chung** thay round-robin tĩnh (thay đổi nhỏ, không đổi hành vi lỗi; cải thiện khi một kết nối chậm).
3. **Retry part + phân loại lỗi** (mềm / 429 transport / FLOOD_WAIT thật / vĩnh viễn), backoff mũ có jitter, tối đa 5 lần. Ranh giới: FLOOD_WAIT thật vẫn dừng cả lần truyền và trả lên tầng trên (không né, không đổi DC — [ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md)).
4. **`RequestBudget` AIMD** + log khi giảm; test bằng transport giả có độ trễ ảo (thuần, không cần mạng — nguồn nói cách này bắt được lỗi hủy worker, nuốt FloodWait, ngân sách tụt).
5. **Pool kết nối tái dùng giữa các file** (mở một lần/phiên, đóng khi đăng xuất/ngắt) — chú ý: kết nối RAW không có reconnect, cần phát hiện kết nối chết giữa các file.
6. **Đo thời hạn sống của `file_id`** rồi mới quyết định resume upload theo part đã xong.

Mọi hằng số (số kết nối, ngưỡng AIMD, timeout, delay) đặt trong một struct config, không rải `const`.

## 10. Tham chiếu trong nguồn (tgmirror, repo ngoài TSMC)

- `src/tgmirror/core/pool.py` — `RequestBudget`, `run_parts` (thuần, ~200 dòng, đọc đầu tiên).
- `src/tgmirror/core/telethon_gateway.py` — `_upload_parallel`, `_upload_senders`, `_new_sender`, `_download_parallel`, `_send_one`, `_upload_album_member`, `_post_multi_media`, `map_exception`.
- `scripts/spike_throughput.py` — cách đo (download/upload/both/files).
- `docs/05-chong-flood.md`, `docs/06-lo-trinh.md` — lý do mỗi số, nhật ký spike.
