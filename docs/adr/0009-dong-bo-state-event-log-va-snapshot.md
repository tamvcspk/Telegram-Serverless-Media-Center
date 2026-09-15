# ADR-0009: Đồng bộ state — event log + snapshot compaction

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)
- **Ghi chú:** ADR này **thay thế** cách làm mô tả ở PRD F1.2.

## Bối cảnh

**Phạm vi của ADR này chỉ là *state riêng tư*** — dữ liệu cá nhân-hoá không có ý nghĩa gì nếu chia sẻ: tiến trình xem, bộ sưu tập, cài đặt, danh sách nguồn đã theo dõi. Nó **không** áp dụng cho *metadata toàn cục* (tiêu đề, thể loại, category, liên kết file media) — thứ sống trong `catalog.json` ở kênh media theo [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md), vì metadata đó vốn dùng chung nên không có gì để "đồng bộ riêng tư" cả. Xem bảng phân tầng ở [architecture.md § 3](../architecture.md#3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục).

PRD F1.2 đề xuất: đóng gói toàn bộ state thành JSON và **ghi đè** (Edit Message) lên một message trong kênh cá nhân, có debounce.

Cách đó hỏng ở đúng kịch bản mà chính PRD mô tả trong User Journey: user xem trên iPad, rồi mở trên máy tính. Nếu iPad còn mở tab (hoặc chỉ đơn giản là ghi muộn hơn), snapshot của nó sẽ **ghi đè toàn bộ** thay đổi vừa tạo trên máy tính. Không phải "mất một trường" mà là mất tất cả những gì thiết bị kia làm giữa hai lần ghi. Đây là hành vi Last-Write-Wins ở mức **toàn bộ tài liệu** — mức thô nhất và mất mát nhiều nhất có thể.

Điều đáng chú ý: một Telegram channel **đã sẵn là một append-only log có thứ tự toàn cục** — `message_id` tăng đơn điệu và do server Telegram quyết định. Đó chính xác là thứ nguyên thuỷ mà một hệ thống đồng bộ cần, và ta đang bỏ phí nó để dùng channel như một ô nhớ duy nhất.

## Các phương án

### A. Snapshot LWW toàn tài liệu (PRD)
- Đơn giản nhất, ít RPC.
- Mất dữ liệu khi dùng nhiều thiết bị — mà đa thiết bị chính là lý do tồn tại của tính năng này.

### B. CRDT (Yjs / Automerge), lưu binary update vào message
- Hợp nhất đúng về mặt lý thuyết, kể cả khi offline lâu.
- Nặng cả về bundle lẫn mô hình tư duy; state của ta phần lớn là **tập hợp** (bộ sưu tập) và **giá trị theo khoá** (tiến trình xem), không phải văn bản cộng tác. Dùng CRDT ở đây là dùng máy ủi để trồng cây.

### C. Event log + snapshot compaction (**được chọn**)
Ghi các delta bất biến; định kỳ nén thành snapshot. Dùng chính thứ tự message của Telegram làm thứ tự toàn cục.

## Quyết định

### Bố cục kênh state cá nhân
Một channel riêng tư do app tạo ngầm (`TSMC State`, có mô tả cảnh báo user đừng xoá):

```text
[pinned]  SNAPSHOT v42     ← state đầy đủ, đính kèm dạng file JSON
          EVENT #43        ← delta, dạng text message JSON
          EVENT #44
          EVENT #45        ← con trỏ đọc của mỗi thiết bị dừng ở đây
```

### Định dạng event
```jsonc
{ "v": 1, "op": "progress.set", "ts": 1755950400000,
  "dev": "a3f9",                       // device id ngẫu nhiên, sinh 1 lần
  "k": "src:123/msg:456", "p": 1830.5 }
```
Các op: `progress.set`, `progress.clear`, `collection.create|rename|delete`, `collection.add|remove`, `source.add|remove|configure`, `settings.set`.

Event dùng message text (giới hạn 4096 ký tự nên phải nhỏ gọn — dùng khoá viết tắt). Snapshot dùng file đính kèm, không bị giới hạn đó.

### Quy tắc hợp nhất (mức từng thực thể, không phải toàn tài liệu)
- `progress.set`: LWW theo `ts`, phạm vi **một phim**. Hai thiết bị xem hai phim khác nhau thì không bao giờ đụng nhau.
- Thành viên collection: **add-wins**. Xoá nhầm còn sửa được; mất một mục đã thêm thì user không hề biết mà tìm lại.
- Đổi tên, cài đặt: LWW theo `ts`, phá hoà bằng `dev` id để mọi thiết bị ra cùng kết quả.
- Đồng hồ lệch: kẹp `ts` vào thời gian server Telegram (lấy được từ MTProto) để một thiết bị sai giờ vài năm không đóng băng vĩnh viễn state của cả tài khoản.

### Compaction
Khi số event vượt 200 hoặc snapshot cũ hơn 7 ngày: **tab leader** ([ADR-0004](./0004-mo-hinh-da-luong.md)) dựng lại snapshot mới, đăng dưới dạng file, ghim nó, rồi xoá các event đã được nén. Thứ tự này quan trọng — ghim trước, xoá sau, để không có khoảnh khắc nào state chỉ tồn tại trong RAM.

### Hydration (F1.3)
1. Đọc message đã ghim → nạp snapshot.
2. Đọc các event có `id` lớn hơn `snapshot.baseMsgId` → replay theo thứ tự.
3. Ghi kết quả vào IndexedDB, lưu con trỏ `lastSeenMsgId`.
4. Lần mở sau: chỉ cần lấy delta từ `lastSeenMsgId` — thường là 0 hoặc vài message.

### Đường ghi
Thay đổi ghi vào bảng `outbox` cục bộ **trước**, UI cập nhật ngay (optimistic). Một tiến trình nền gộp lô và gửi mỗi 10 giây, hoặc ngay lập tức khi `visibilitychange` chuyển sang hidden (bắt được kịch bản "user đóng tab đột ngột" trong PRD Journey mục 3.4). Chỉ xoá khỏi outbox sau khi Telegram xác nhận. Mất mạng thì event nằm yên trong outbox, không mất.

## Hệ quả

**Tích cực**
- Không mất dữ liệu do đa thiết bị — vấn đề nghiêm trọng nhất của phương án PRD được xử lý.
- Event bất biến nên đồng bộ có thể **audit được**: khi có bug, đọc log là biết chuyện gì đã xảy ra.
- Delta nhỏ nên ít tốn RPC hơn ghi đè cả snapshot mỗi lần.

**Tiêu cực / phải chấp nhận**
- Phức tạp hơn: phải viết replay engine và phải test hợp nhất bằng property-based test (sinh ngẫu nhiên các thứ tự event, kiểm tra tính hội tụ).
- Kênh state có thể phình nếu compaction không chạy (ví dụ user chỉ dùng một thiết bị rồi tab leader chết) → thêm chỉ báo tình trạng đồng bộ trong Cài đặt.
- Giới hạn tần suất gửi tin nhắn của Telegram → **bắt buộc** gộp lô; không được gửi mỗi tick tiến trình xem một message. Mốc thời gian xem chỉ ghi cục bộ mỗi 10 giây (PRD F4.3) và chỉ đẩy lên mạng khi tạm dừng, chuyển phim, hoặc ẩn tab.

## Cập nhật sau khi Accepted (2026-08-24, slice Sync F1.2/F1.3)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Triển khai + kiểm chứng bằng tài khoản Telegram thật trên staging:

- **Đã xác nhận hoạt động đúng:** `messages.sendMessage` ghi event, đường ghi optimistic (outbox → flush), và `getSyncMeta`/outbox count phản ánh đúng qua `liveQuery` ở main thread dù Core Worker mới là nơi ghi (ADR-0007 "đường đọc"/"đường ghi" — xác nhận đúng như thiết kế, kể cả khi state được ghi từ một context khác).
- **Một bug thật đã gặp — không phải ở GramJS/MTProto, mà ở lớp nối dây Angular:** `createCoreWorkerClient()` (worker-host) không phải singleton; hai component (`Login`, `SyncStatus`) mỗi bên tự gọi hàm này trong field initializer riêng, tạo ra **hai Core Worker độc lập trong cùng một tab** — vi phạm ngầm bất biến "một Core Worker/tab" của [ADR-0004](./0004-mo-hinh-da-luong.md) mà trước đó chưa có gì enforce trong code. Hệ quả: `SyncStatus` gọi RPC ghi (`setSetting`/`forceFlush`) vào một worker instance **chưa từng `login()`/`initSync()`**, nên `mutate()` ném lỗi bị nuốt (không có `catch`) và `forceFlush()` no-op qua optional chaining — "sự kiện chờ gửi luôn = 0" mà không có triệu chứng lỗi nào lộ ra, vì phần đọc trạng thái vẫn đúng (đọc thẳng IndexedDB, không qua RPC). Đã vá bằng singleton cấp module trong `createCoreWorkerClient()` + thêm test regression (`worker-host/src/index.spec.ts`) + surface lỗi RPC ra UI thay vì nuốt im lặng.
- **Chưa kiểm chứng bằng thiết bị thật:** nén snapshot (`publishSnapshot`/`sendFile`+ghim+xoá — ngưỡng >200 event hoặc snapshot >7 ngày không tự phát sinh trong một lần dùng bình thường) và `serverNow()` (hiện chỉ trả `Date.now()`, chưa có cách xác nhận đáng tin cậy để đọc time-offset nội bộ của GramJS — xem comment trong `gateway-sync.ts`). Cả hai nằm trên cùng code path đã kiểm chứng (`sendMessage`/`getMessages`/`getEntity`), nên rủi ro được đánh giá thấp, nhưng "cùng code path" không phải là "đã test" — cần xác nhận riêng khi có dịp (log đủ 200 event thật, hoặc chờ đủ 7 ngày).

## Cập nhật sau khi Accepted (2026-09-15, rà soát brainstorm 2026-08-29 + vá bug thật)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

**1. Bug thật phát hiện qua rà soát (chưa từng xảy ra trên thiết bị thật, chưa verify lại sau vá) — trần phân trang khi hydrate:**
`fetchEventsSince()` (`libs/core-mtproto/src/gateway-sync.ts`) trước đây gọi `getMessages()` đúng **một lần** với `limit: 500` rồi coi như đã đọc hết toàn bộ event kể từ `baseMsgId`. Nếu số event thật kể từ snapshot vượt quá 500 — đúng kịch bản "compaction không chạy đủ lâu" đã ghi ở mục Hệ quả phía trên ("Kênh state có thể phình nếu compaction không chạy") — `hydrate()`/`maybeCompact()` sẽ **âm thầm bỏ sót** phần event còn lại. Đây không phải Telegram xoá gì; event vẫn còn nguyên trên kênh, chỉ là code không đọc hết trang tiếp theo.

Đã vá bằng cho `fetchEventsSince()` tự **lặp** gọi `getMessages()` nhiều trang (con trỏ `minId` nhích theo id message **thật** cuối mỗi trang — kể cả message không parse được thành `SyncEvent` hợp lệ, tránh kẹt vòng lặp nếu một trang toàn message hỏng) tới khi một trang trả về **ít hơn** trần trang (500, dấu hiệu duy nhất GramJS cung cấp để biết đã hết — không kèm tổng số). Có test mới (`libs/core-mtproto/src/gateway-sync.spec.ts`) mô phỏng đúng kịch bản 2 trang (500 message, một message hỏng lẫn vào giữa, rồi 3 message trang sau) xác nhận cả việc gộp kết quả đúng lẫn giá trị `minId` gọi lần hai đúng bằng id message cuối trang một. **Đây là sửa lỗi triển khai, không đụng nội dung Quyết định "Hydration (F1.3)"** — thứ tự đọc snapshot ghim → replay event vẫn giữ nguyên, chỉ khác ở chỗ "đọc event" giờ đọc **hết**, không dừng ở trang đầu.

**2. Đóng gap đã ghi sẵn ở mục Hệ quả ("→ thêm chỉ báo tình trạng đồng bộ trong Cài đặt") + roadmap.md brainstorm 2026-08-29 — ngưỡng nén theo tuổi giờ cấu hình được, có chỉ báo ở Settings:**
Ngưỡng "snapshot cũ hơn 7 ngày" (mục Quyết định "Compaction" phía trên) **giữ nguyên giá trị mặc định 7 ngày** — addendum này chỉ thêm **khả năng chỉnh**, không đổi mặc định, nên theo đúng phân loại ở [docs/adr/README.md](./README.md) (chỉ đổi MẶC ĐỊNH mới bắt buộc addendum) phần này về nguyên tắc không bắt buộc phải ghi — ghi lại ở đây cho đủ bức tranh cùng bug #1 ở trên, không phải vì tự nó thay đổi quyết định.

- `decideCompaction()` (`libs/core-sync/src/compaction.ts`) nhận thêm tham số tuỳ chọn thứ ba `maxSnapshotAgeMs`, mặc định `DEFAULT_COMPACTION_MAX_SNAPSHOT_AGE_MS` (7 ngày) nếu không truyền — hàm thuần tuý vẫn giữ nguyên hành vi cũ cho mọi lệnh gọi không truyền tham số này.
- `maybeCompact()` đọc `storage.getSyncState().settings['compactionMaxSnapshotAgeDays']?.val` (setting đồng bộ qua `settings.set` SyncEvent, **cùng cơ chế** `maxConcurrency` đã có — literal string key lặp lại giữa nơi đọc/ghi, không export hằng dùng chung, đúng quy ước đã có của repo cho loại setting này) — có giá trị hợp lệ (số > 0) thì kẹp về [1, 90] ngày trước khi dùng (phòng giá trị hỏng do thiết bị khác ghi, không tin tuyệt đối); giá trị không phải số/`NaN`/`<= 0` → rơi về mặc định 7 ngày thay vì âm thầm biến thành "1 ngày" (một hành vi không ai yêu cầu).
- Ngưỡng `COMPACTION_EVENT_THRESHOLD` (>200 event) **giữ nguyên, không cấu hình được** — đúng roadmap.md § Sync & dữ liệu ("lưới an toàn cứng").
- Settings (`apps/web/src/app/settings`) thêm khối **"Đồng bộ"** mới — thứ NĂM, KHÔNG thuộc bốn khối gốc của mockup Màn hình 7 (`docs/ux-design.md`: Tài khoản/Lưu trữ/Mạng/Chẩn đoán): slider chỉnh ngưỡng (1-30 ngày ở UI, hẹp hơn trần phòng thủ 1-90 ngày thật sự ở `compaction.ts` — trần UI chỉ giữ slider trong khoảng còn ý nghĩa thực tế) ghi qua `client.setSetting('compactionMaxSnapshotAgeDays', days)` (RPC chung có sẵn, không cần method chuyên biệt như `setMaxConcurrency()` — ngưỡng này không cần áp dụng ngay cho một tiến trình nền đang chạy, `maybeCompact()` tự đọc lại mỗi lượt kiểm tra định kỳ), cộng chỉ báo `compactionAgeLabel` đọc `SyncMetaRecord.lastSnapshotAt` qua `liveQuery` — hiện "chưa từng nén" (không bịa số ngày) khi trường này `undefined`, đúng thực tế `lastSnapshotAt` chỉ được ghi lúc `maybeCompact()` nén thành công lần đầu, không phải lúc hydrate.

**Trạng thái kiểm chứng:** cả hai mục trên chỉ mới qua unit test (fake gateway/storage, `libs/core-mtproto/src/gateway-sync.spec.ts` + `libs/core-sync/src/compaction.spec.ts`) và `ng build`/`npm run lint` sạch — **CHƯA verify bằng tài khoản/thiết bị thật** (compaction tự nhiên vẫn chưa từng tự phát sinh trong một lần dùng bình thường, cùng ghi chú "chưa kiểm chứng" đã có ở addendum 2026-08-24 phía trên — addendum này không thay đổi thực tế đó, chỉ thêm test bao phủ code path rộng hơn).
