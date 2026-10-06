# ADR-0022: Item nhiều phần (`parts[]`) trong Catalog Spec v1 — một phim logic, N video Telegram độc lập

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-05
- **Liên quan:** [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md), [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md) (§ addendum 2026-09-19, kế hoạch chuẩn hoá dung lượng), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md), [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)

## Bối cảnh

Telegram giới hạn dung lượng một file upload (4 GB với Premium, thấp hơn với tài khoản thường — chưa kiểm chứng, xem [ADR-0017 § addendum 2026-09-13](./0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-13-đóng-gap-thật-của-m7--chặn-kích-thước-file-trước-khi-upload)). Với phim 4K vượt trần, lựa chọn duy nhất hiện nay là nén lại (hàng chục phút, mất chất lượng, `h264_mf` có mức sàn theo nội dung — SPIKE-11). Kế hoạch ở [ADR-0017 § addendum 2026-09-19](./0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-19-kế-hoạch-chuẩn-hoá-dung-lượng-tiền-kiểm-chia-phần-độc-lập-chốt-sau-brainstorm) đã chốt hướng **chia phần**: cắt stream-copy tại keyframe, mỗi phần là một video Telegram độc lập. Addendum đó nói thẳng: *cần ADR mới trước khi code, vì đụng catalog-spec + Player + Sources*. Đây là ADR đó.

Hiện trạng đã khảo sát (2026-10-05) — mọi nơi giả định "một item = một message":

- [catalog.ts](../../libs/shared-models/src/catalog.ts): `catalogItemV1Schema` có `msgId` bắt buộc, `subs[].msgId`, `poster.msgId`; không có khái niệm nhiều message cho một item. Mảng bị kẹp `MAX_ARRAY_LENGTH = 100`.
- Index: `MediaRecord extends CatalogItemV1`, khoá Dexie `[sourceId+msgId]` ([media-store.ts](../../libs/core-storage/src/media-store.ts)). Tier catalog (T1) thay toàn bộ item của nguồn từ `items[]`; tier quét lịch sử (T2/T3, [index-engine.ts](../../libs/core-index/src/index-engine.ts)) biến **mỗi video message thành một item** — nếu không xử lý, N phần sẽ hiện thành N phim trong Browse.
- Player: route `/play/:sourceId/:msgId`, `streamUrl = /_stream/{sourceId}/{msgId}`, khoá tiến độ `src:{sourceId}/msg:{msgId}` ([player.ts](../../apps/web/src/app/player/player.ts)); Service Worker và `stream-bridge` làm việc theo `msgId` đơn lẻ.
- Ingest desktop: `merge_catalog`/`publishCatalogMetadata` gộp theo `msgId`; xoá item = xoá message; "Tìm file mồ côi" so message kênh với catalog theo `msgId`.

## Các phương án

### A. N item riêng biệt trong catalog, nối nhau bằng `series`/trường liên kết
- ✅ Không đổi schema; Player không đổi.
- ❌ Làm bẩn Browse/Collections/tìm kiếm (một phim hiện N tile), tiến độ xem tách N khoá, `series.episode` bị lạm dụng làm số phần (phim bộ thật sẽ lẫn). Đã bị loại ở brainstorm 2026-09-19.

### B. Một item logic với `parts[]` (**được chọn**)
- ✅ Browse/tìm kiếm/tiến độ vẫn một phim; client cũ phát được phần 1; mỗi phần vẫn xem được riêng trên Telegram gốc.
- ❌ Đụng schema, index tầng quét lịch sử, Player, ingest. Phần còn lại của ADR là cái giá đó.

### C. Manifest HLS/DASH ghép phần thành một luồng
- ❌ Cần MSE — [ADR-0005](./0005-streaming-qua-service-worker-http-range.md) đã loại MSE; thêm một định dạng thứ hai ngoài MP4 progressive.

### D. Ghép phần phía máy chủ / một file khổng lồ
- ❌ Vi phạm bất biến #1 (không server); Telegram không nhận file vượt trần.

### E. Nâng Catalog Spec lên v2
- ❌ Không cần: v1 cho phép thêm trường optional không đổi nghĩa trường cũ ([catalog-spec.md §Phiên bản](../catalog-spec.md#phiên-bản)). Bump major làm mọi client cũ **bỏ cả catalog** — cái giá không tương xứng.

## Quyết định

### 1. Schema — thêm trường optional `parts`, KHÔNG bump version

```jsonc
{
  "msgId": 4567,                 // = parts[0].msgId (client cũ phát được phần 1)
  "runtime": 9960,               // TỔNG các phần, giây
  "size": 6012345678,            // TỔNG các phần, byte
  "subs": [{ "lang": "vi", "msgId": 4600 }],   // BẢN SAO parts[0].subs (cho client cũ)
  "parts": [
    { "msgId": 4567, "runtime": 4980, "size": 3006172839,
      "subs": [{ "lang": "vi", "msgId": 4600 }] },
    { "msgId": 4568, "runtime": 4980, "size": 3006172839,
      "subs": [{ "lang": "vi", "msgId": 4601 }] }
  ]
}
```

- `parts[i]` = `{ msgId (bắt buộc), runtime (giây, bắt buộc, > 0), size?, subs? }`. `runtime` bắt buộc vì Player dựng timeline ảo (§5) cần biết tổng thời lượng và điểm chuyển phần **trước** khi tải phần kế.
- `subs` của từng phần **đã rebase về 0 tại đầu phần**; cue vắt ngang điểm cắt được nhân đôi và cắt ngắn ở cả hai phía. Player không phải tính offset phụ đề.
- Item-level `msgId`/`runtime`/`size`/`subs` giữ nghĩa cũ cho client không biết `parts` (một phim, phần đầu phát được, tổng số liệu đúng) — đây là lý do không cần bump version.
- Client hiểu `parts` **bỏ qua** `subs` cấp item và chỉ đọc `parts[i].subs`.

### 2. Validate (catalog là JSON người lạ — bất biến #7, ADR-0011)

`parts` chỉ được chấp nhận khi **tất cả** điều kiện sau đúng; sai bất kỳ điều kiện nào thì **bỏ riêng trường `parts`** (item vẫn hợp lệ, phát như một phim một phần — suy biến an toàn, không "sửa tạm"):

1. `2 ≤ parts.length ≤ MAX_PARTS = 50` (số phần tối đa; 50 × ≤4 GB đã vượt mọi file thực tế, và thấp hơn `MAX_ARRAY_LENGTH` để mảng hết phần có thể kèm phụ đề).
2. Mọi `parts[i].msgId` là số nguyên dương, **đôi một khác nhau**, và `parts[0].msgId === item.msgId`.
3. Mọi `runtime` hữu hạn, `> 0`; `size` nếu có thì hữu hạn, `≥ 0`. Kẹp độ dài `subs` mỗi phần như `subs` cấp item.
4. Không msgId nào của `parts` trùng `msgId` của **item khác** trong cùng catalog (kiểm ở tầng gộp catalog, không ở schema từng item): một message không được thuộc hai item — chặn catalog độc hại "mượn" video của item khác.

Không tin `parts[i].size`/`runtime` để cấp phát bộ nhớ (cùng điểm 5 ở catalog-spec "Client đọc catalog phải làm gì"); số thật lấy từ `DocumentAttribute` khi phát.

### 3. Index (T1/T2/T3)

- **Lưu trữ:** `MediaRecord` giữ `parts` inline; khoá `[sourceId+msgId]` và các index Dexie **không đổi**, không cần `version()` mới. `parts` không được index.
- **T1 (catalog):** không đổi hành vi — item đã là đơn vị logic. `itemCount` đếm item logic.
- **T2/T3 (quét lịch sử, không có catalog):** một video message tên `*.partIofN.*` (hoặc caption `… — Phần i/N`) được **nhóm** theo (tên gốc, N) trong cùng lượt quét thành MỘT item có `parts`, `msgId` = phần 1. Nhóm **thiếu phần** (chưa quét tới / đã xoá) **không** bị giấu: các phần có mặt hiện thành item riêng, tiêu đề ghi rõ "Phần i/N", để không mất nội dung và để dò lại ở lượt quét sau. Hashtag/season/episode lấy từ phần 1 (mọi phần mang cùng hashtag caption nên tìm theo hashtag trên Telegram thấy đủ phần).
- **Không tin quy ước tên làm biên an ninh:** nhóm chỉ ghép message cùng publisher đã được phân loại tin cậy như nhau (ADR-0010 §3), và vẫn qua điều kiện §2.

### 4. Ingest desktop (Giai đoạn 4 thực thi, ràng buộc ghi ở đây)

- Mỗi phần: video Telegram độc lập (moov/thumbnail/duration riêng), tên `X.partIofN.mp4`, caption `Tiêu đề — Phần i/N` + hashtag như phần 1.
- **Catalog là nguồn sự thật cho "phần nào thuộc phim nào"**; quy ước tên chỉ để quét mồ côi và T2/T3.
- **Quét mồ côi:** message video không được tham chiếu bởi `item.msgId`, `parts[].msgId`, `subs`, `poster` mới là mồ côi; các phần mang tên `partIofN` cùng gốc gom thành **một** mục để user xử lý một lần.
- **Xoá item** = xoá mọi message trong `parts[]` + `subs`/`poster` của từng phần (hành động mạng không hoàn tác — **hỏi xác nhận liệt kê rõ số message sẽ xoá**, cùng tiền lệ "Xoá khỏi catalog + xoá message trên kênh"). Upload dở: user xoá item khỏi danh sách upload thì xoá các phần đã lên kênh; tắt app đột ngột để "Tìm file mồ côi" xử lý — chính sách đã chốt ở ADR-0017, giữ nguyên.
- **Gộp catalog / sửa metadata:** `mergeCatalogItems` và `publishCatalogMetadata` phải **bảo toàn** `parts` (patch metadata không được làm rơi `parts`) và kiểm điều kiện §2.4 khi gộp.
- Catalog chỉ được ghi (publish) **sau khi mọi phần đã lên kênh**: không bao giờ công bố item có `parts` trỏ tới message chưa tồn tại.

### 5. Player (Giai đoạn 5 thực thi, ràng buộc ghi ở đây)

- Route/khoá item vẫn theo `item.msgId`. Mỗi phần phát qua **`/_stream/{sourceId}/{part.msgId}`** — Service Worker, `stream-bridge`, Core Worker **không đổi** (vẫn thấy một message một lần), ranh giới ADR-0004/0005 giữ nguyên.
- **Timeline ảo:** tổng thời lượng = Σ `parts[i].runtime`; thanh tua và seek ánh xạ vị trí toàn cục → (phần, offset). Controls gốc của `<video>` chỉ thấy một phần nên item nhiều phần dùng thanh tua tuỳ biến; item một phần giữ nguyên controls hiện tại.
- **Tiến độ xem lưu theo thời điểm TOÀN CỤC** (giây từ đầu phim), khoá vẫn theo `item.msgId` ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md): không đổi schema state; chia lại phần sau này không làm hỏng tiến độ).
- **Chuyển phần:** mặc định (phương án V1) đổi `src` của cùng một `<video>` khi `ended`, kèm **prefetch phần kế** (mở `getStreamInfo` + nạp trước đoạn đầu) trong lúc phát phần hiện tại. ADR-0005 cấm MSE nên chấp nhận một hụt nhẹ; cắt tại chuyển cảnh/im lặng (ADR-0017 addendum 9) giúp che. **Chỉ** làm double-buffer hai `<video>` (V2/V3) nếu [SPIKE-12](../spikes/README.md#spike-12) cho thấy V1 không đạt — không tối ưu theo phỏng đoán.
- Phụ đề: tải `parts[i].subs` của phần đang phát; không cần offset.

### 6. Phạm vi KHÔNG đổi

Không đổi Catalog Spec major version, không đổi Service Worker/Core Worker/`TelegramGateway`, không đổi schema Dexie, không đổi state riêng tư (bất biến #5/#6 nguyên vẹn: `parts` là metadata toàn cục, nằm trong `catalog.json`, không đi vào kênh state).

## Hệ quả

**Tích cực**
- Phim 4K vượt trần ra một item logic, không mất chất lượng, vài giây thay vì hàng chục phút.
- Tương thích ngược: client cũ vẫn thấy một phim và phát được phần đầu; catalog-spec v1 không bump nên không client nào bỏ cả catalog.
- Mỗi phần xem được riêng trên Telegram gốc — user không bị khoá vào web app.
- Player/SW/Core Worker không đổi giao thức; rủi ro tập trung ở một chỗ có thể đo (SPIKE-12).

**Tiêu cực / phải chấp nhận**
- **Client cũ chỉ phát phần 1** nhưng hiện thời lượng/dung lượng tổng — lệch kỳ vọng nhưng không hỏng; chấp nhận vì đổi lại không bump version.
- **Thanh tua tuỳ biến cho item nhiều phần:** mất controls gốc (PiP/AirPlay/cast qua controls gốc có thể kém hơn) — cần kiểm trên thiết bị ở Giai đoạn 5.
- **Hụt nhẹ lúc chuyển phần** là không tránh khỏi khi không MSE; mức hụt chấp nhận được **chưa đo** — đây là giả thuyết, mở [SPIKE-12](../spikes/README.md#spike-12). iOS có thể chặn phát tự động phần kế.
- **T2/T3 phức tạp hơn:** nhóm theo quy ước tên là heuristic; nhóm thiếu phần hiện rời rạc. Chấp nhận vì đường chính (catalog) không phụ thuộc heuristic này.
- **Xoá/mồ côi/gộp catalog phải biết `parts`** — nhiều điểm chạm (liệt kê ở §4); bỏ sót một điểm là rò message mồ côi hoặc xoá thiếu phần. Mỗi điểm cần test riêng ở Giai đoạn 4.
- `MAX_PARTS = 50` và ngưỡng validate là điểm bắt đầu; điều chỉnh khi có dữ liệu thật (không đổi schema nếu chỉ nới ngưỡng).

## Việc theo sau

- Cập nhật [catalog-spec.md](../catalog-spec.md) (mục `parts`) và `catalogItemV1Schema` + test — thuộc Giai đoạn 4 (cùng lúc ingest ghi `parts`), không làm trước vì chưa có nơi nào ghi/đọc.
- [SPIKE-12](../spikes/README.md#spike-12): đo độ trễ chuyển phần — kết quả quyết V1 hay double-buffer trước Giai đoạn 5.
- Giai đoạn 4 (ingest chia file), Giai đoạn 5 (Player) theo [roadmap](../roadmap.md#ingest).


## Cập nhật sau khi Accepted (2026-10-05, Giai đoạn 4: ingest chia file)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Thực hiện phía **ingest** và **schema** của ADR này. Không có quyết định nào ở trên bị đổi.

**Đã làm:**
- Schema `parts` + `dropCollidingParts()` ([catalog.ts](../../libs/shared-models/src/catalog.ts)), áp dụng ở cả đường đọc catalog (`tryCatalogTier`) và đường gộp (`mergeCatalogItems`). Validate đúng §2 (2–50 phần, msgId duy nhất, `parts[0].msgId === msgId`, không trùng item khác; sai thì bỏ riêng `parts`). Có test.
- Rust (`ingest-ffmpeg`): `scan_keyframes()` liệt kê keyframe **sạch** (loại keyframe open-GOP có frame dẫn đầu pts nhỏ hơn) + offset byte tích luỹ; `split_at()` cắt stream-copy. Command Tauri: `scan_split_candidates`, `split_video`, `read_subtitle_text`, `write_temp_text_file` (hai command sau chỉ chạm thư mục tạm của app, đuôi `.srt`/`.vtt`, ≤ 20 MB).
- TypeScript (`core-ingest`, hàm thuần): `planSplit()` (chia ĐỀU, chọn keyframe gần mốc chia đều theo byte, tăng số phần nếu không thoả, margin 3%), `rebaseSubtitle()` (SRT/VTT → SRT theo cửa sổ phần), `partFileName()`/`parsePartFileName()`/`composePartCaption()`.
- Dialog tiền kiểm: thẻ "Chia phần" mở khoá cho Hạng A/B/C (Hạng D vẫn khoá), chọn sẵn theo gợi ý mặc định ADR-0017 (cần giảm > 15% → chia).
- `workspace.ts`: remux như thường → nếu vẫn vượt trần thì quét keyframe → `planSplit()` → cắt → upload từng phần (tên `X.partIofN.mp4`, caption "Tiêu đề — Phần i/N") → phụ đề rebase từng phần (cả phụ đề nhúng lẫn sidecar) → MỘT item catalog với `parts[]`, `msgId`/`subs` của phần 1, `runtime`/`size` là tổng. Chỉ publish catalog sau khi mọi phần đã lên kênh (publish theo batch như cũ).
- Trình quản lý catalog: đối soát kiểm mọi message của các phần; quét mồ côi coi phần là message đã có trong catalog và **gom đủ N phần `partIofN` thành MỘT mục** (nhóm thiếu/trùng phần hoặc thiếu duration hiện từng message riêng, không giấu); xoá item xoá mọi message phần (hỏi xác nhận nêu rõ số message); đồng bộ hashtag caption giữ "— Phần i/N" cho từng phần.

**Đã kiểm chứng (2026-10-05):** `check_split` trên fixture tổng hợp H.264 (có B-frame, GOP 2s) + AAC 60s cắt 3 phần: tổng thời lượng 60.022s (nguồn 60.000s), đúng 1500 khung hình, `ffmpeg -v error` không báo lỗi giải mã, lệch tiếng/hình đầu mỗi phần ≤ 15 ms, tổng dung lượng các phần lớn hơn nguồn 0.04% (moov mỗi phần). Dung lượng thật phần đầu lệch xấp xỉ theo byte +0.8% — nằm trong margin 3%. 394 test thư viện + build `apps/web` + build UI desktop + `cargo check` sạch.

**CHƯA kiểm chứng — không được viết như đã xong:**
- Chưa chạy end-to-end bằng tài khoản Telegram thật (upload N phần, publish catalog, xoá, quét mồ côi) — checklist ở [pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--giai-đoạn-4-chia-phần-2026-10-05).
- Chưa thử file thật vài GB, nguồn MKV Hạng C, nguồn VFR/HEVC; chưa thử nguồn không có audio (`remux()` hiện đòi có track audio nên không tới được bước chia).
- Cắt trên keyframe `is_key` của MP4 H.264 — chưa xét riêng HEVC.

**Chưa làm (lệch so với kế hoạch ban đầu của Giai đoạn 4, để phiên sau):**
1. **Chấm điểm chuyển cảnh/im lặng:** `planSplit()` đã nhận `sceneScore`/`silent` tuỳ chọn (có test) nhưng Rust CHƯA sinh chúng (`silencedetect`, so sánh cảnh) — điểm cắt hiện chỉ dựa vào vị trí byte, tức cắt tại keyframe gần mốc chia đều nhất, có thể giữa câu thoại.
2. **Editor timeline** (marker, thumbnail trước/sau, kéo sang ứng viên khác, kích thước từng phần cập nhật trực tiếp) trong panel Nâng cao — chưa có UI; user hiện không chỉnh được điểm cắt.
3. **Tầng quét lịch sử T2/T3** (§3) chưa nhóm phần theo `partIofN` — chỉ ảnh hưởng kênh không có catalog; đường chính (catalog) không bị. Thuộc phía web app, cùng đợt Player (Giai đoạn 5).
4. **Dọn phần đã upload khi một phần giữa chừng lỗi:** hiện để lại trên kênh (chưa vào catalog) cho "Tìm file mồ côi" gom lại; chưa tự xoá khi user xoá item khỏi hàng đợi.

**Đánh đổi chấp nhận được thêm:** vì chia SAU remux (tái dùng nguyên `remux()` cho Hạng A/B/C), đĩa tạm cần ≈ 2× dung lượng file (bản remux + các phần) trong lúc xử lý. Một lượt cắt trực tiếp từ nguồn tiết kiệm đĩa nhưng phải nhân đôi logic audio của `remux()` — chưa đáng.
