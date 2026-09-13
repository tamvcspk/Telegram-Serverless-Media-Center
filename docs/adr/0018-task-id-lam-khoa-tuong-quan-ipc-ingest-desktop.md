# ADR-0018: Task ID (UUID) làm khoá tương quan IPC cho pipeline upload — `tsmc-ingest-desktop`

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-13
- **Liên quan:** [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md)

## Bối cảnh

Bug thật, đã xác nhận bằng đọc code (không phải suy đoán): progress bar ở Workspace hiện `indeterminate` với Hạng B/C/D. Nguyên nhân —

- `ui/src/app/workspace/workspace.ts` gọi `uploadVideo({ filePath: prepared.remuxed_path, ... })` (dòng ~662) — truyền path file **tạm sau remux** (`.mp4`).
- `src-tauri/src/upload.rs::upload_video` nhận tham số đó làm `file_path`, dùng nguyên làm `progress_path` gắn vào mọi event `"upload-progress"` (`UploadProgressDto.path`).
- Phía Angular, `updateQueueItem(p.path, ...)` so khớp event với `item.path` — path **gốc** của file (`.avi`...), gán lúc thêm vào queue (`staged.path`).
- Hai path không khớp nhau ⇒ không hàng nào được cập nhật ⇒ progress bar đứng ở trạng thái mặc định (indeterminate).

`path` được dùng làm khoá tương quan xuyên suốt pipeline nhiều bước (probe → remux/re-encode → thumbnail → rút phụ đề → upload video → upload phụ đề), nhưng **bản thân path không ổn định** — nó đổi tên/đổi đuôi ở mỗi bước biến đổi file (`pipeline.rs::prepare_upload_blocking` sinh `remuxed_path`, `thumbnail_path`, các `sub_path` riêng). Bug hiện tại là hệ quả trực tiếp của việc dùng một giá trị không ổn định làm khoá tương quan — đúng loại rủi ro mà CLAUDE.md đã cảnh báo: "Mọi message xuyên luồng phải có correlation id."

**Kiến trúc thật hiện tại (đọc trực tiếp `state.rs`/`upload.rs`, không phải giả định):** pipeline chạy **tuần tự**, tối đa một `upload_video()` sống tại một thời điểm — `AppState.active_cancel: Mutex<Option<CancelFlag>>` là **một** cờ duy nhất (không phải map/registry theo id), `cancel_upload()` không nhận tham số, và Angular giữ đúng một `currentUploadPath: signal<string | null>`. Đây **không phải** hệ thống đa tác vụ song song. Bản thảo quyết định ban đầu của ADR này (thảo luận thiết kế trước khi đọc code) giả định một registry kiểu `DashMap<uuid, TaskState>` với `get_active_tasks()` trả về danh sách — sai so với thực tế, và bị loại bỏ ở bước review trước khi ghi ADR. Quyết định dưới đây bám đúng mô hình tuần tự thật.

## Các phương án

### A. Chỉ sửa đúng chỗ gọi sai (truyền `item.path` thay vì `prepared.remuxed_path`)
- ✅ Nhỏ nhất có thể — một dòng ở `workspace.ts`.
- ❌ Không sửa nguyên nhân gốc: `path` vẫn là khoá tương quan, vẫn không ổn định. Bất kỳ giai đoạn mới nào thêm sau này (vd một bước sinh preview GIF, watermark...) mà lỡ tái sử dụng biến path đã bị biến đổi sẽ tái tạo đúng lớp bug này.
- ❌ Không tuân đúng tinh thần bất biến CLAUDE.md về correlation id — patch triệu chứng, không phải nguyên nhân.
- **Loại.**

### B. UUID ổn định làm khoá tương quan, giữ mô hình tuần tự (**được chọn**)
- ✅ Khoá tương quan tách hẳn khỏi việc file bị đổi tên/đổi đuôi bao nhiêu lần qua các giai đoạn.
- ✅ Không cần registry/map — đúng với thực tế "tối đa 1 task sống tại 1 thời điểm", tránh thêm phức tạp không cần thiết (DashMap, cancel theo id trong tập nhiều id).
- ✅ Tiện thể vá được một race có thật trong code hiện tại (xem "Quyết định" #2).
- ⚠️ Đổi chữ ký `upload_video`/`cancel_upload` (thêm tham số `task_id`) — breaking change nội bộ, phải sửa đồng bộ cả hai phía Rust/Angular trong cùng một PR.

## Quyết định

Dùng **UUID sinh phía Angular** (`crypto.randomUUID()`) làm khoá tương quan duy nhất cho một file trong toàn bộ vòng đời của nó qua pipeline, thay cho path file. Cụ thể:

1. **Sinh UUID tại thời điểm thêm vào queue** (lúc drop file / lúc file được probe xong và hiển thị ở bảng metadata) — gắn vào `QueueItem`/`UploadQueueItem` phía Angular như một field độc lập, không suy ra từ path.

2. **Mọi Tauri command và mọi DTO event liên quan tới một file cụ thể mang `task_id: String`:**
   - `upload_video(...)` nhận thêm tham số `task_id`.
   - `cancel_upload(...)` đổi chữ ký từ không tham số sang `cancel_upload(task_id: String)`.
   - `UploadProgressDto`, `PipelineStageDto` (`dto.rs`) thêm field `task_id: String` — đây là khoá Angular dùng để so khớp (`updateQueueItem`/`updateItem` chuyển sang match theo `task_id`, không còn theo `path`). Field `path` giữ nguyên trong DTO nhưng chỉ còn vai trò hiển thị/log, không phải khoá tương quan.

3. **`AppState.active_cancel` đổi kiểu** từ `Mutex<Option<CancelFlag>>` sang `Mutex<Option<(String, CancelFlag)>>` (task_id đi kèm cờ huỷ). `cancel_upload(task_id)` chỉ gọi `.cancel()` khi `task_id` khớp với task đang giữ cờ; nếu không khớp (task đã xong, hoặc — race có thật trong code hiện tại — lệnh huỷ tới đúng lúc giao ca sang file kế tiếp trong queue) thì **no-op, trả `Ok(())`**, không lỗi. Đây là một sửa chữa thật, không chỉ lý thuyết: `cancel_upload()` không tham số hiện tại có thể huỷ nhầm file **kế tiếp** nếu lệnh huỷ đến đúng lúc `active_cancel` vừa được set lại cho task mới.

4. **Không dùng map/registry đa tác vụ.** Giữ đúng một "current task" (`Option<(String, CancelFlag)>`), khớp với thực tế pipeline tuần tự đã ghi ở `state.rs`. Nếu sau này pipeline đổi sang xử lý song song nhiều file, đây là quyết định cần ADR riêng — không mở rộng ngầm ở đây.

5. **Hydration khi `WorkspaceComponent` remount** (điều hướng đi/về trong cùng phiên app đang chạy, ví dụ "Quay lại chọn kênh" rồi quay lại Workspace): thêm command mới `get_current_task() -> Option<CurrentTaskDto { task_id, path, stage, progress }>`, đọc từ một field mới `AppState.current_task: Mutex<Option<CurrentTaskSnapshot>>` (được cập nhật mỗi lần `on_progress`/`emit_stage` bắn event — không chỉ lúc bắt đầu/kết thúc). Thứ tự bắt buộc phía Angular: **đăng ký listener `"upload-progress"`/`"pipeline-stage"` trước, gọi `get_current_task()` sau** — để không lọt mất event bắn ra đúng lúc đang chờ response của lệnh hydrate.
   **Phạm vi rõ ràng, không nói quá:** cơ chế này chỉ đảm bảo không mất track tiến trình trong khi tiến trình Tauri còn sống (app chưa bị đóng hẳn). **Không phải crash-recovery** sau khi đóng app hoàn toàn — nếu cần, đó là tính năng khác (persist state ra đĩa), để ngỏ, không thuộc ADR này.

6. **`QueueStore`/`DraftStore` (Angular) là service `providedIn: 'root'`** — sống xuyên vòng đời route, không gắn với `WorkspaceComponent`, để hydration ở #5 có chỗ ghi vào mà không bị Angular tự huỷ khi component unmount.

## Quyết định kèm theo (cùng phiên thiết kế, không phải trọng tâm ADR này)

Các quyết định UX sau được chốt trong cùng buổi thảo luận, ảnh hưởng cùng slice code nhưng không phải bản chất "khoá tương quan IPC" của ADR này — ghi lại để không thất lạc:

- **Không làm App Shell / Unified DataGrid.** Có cân nhắc gộp Queue trái + Bảng metadata phải thành một grid phẳng, điều hướng kiểu app-shell (top bar đổi kênh, sidebar route). **Loại** vì: (a) không có bằng chứng nhu cầu multi-channel-per-batch thật sự tồn tại; (b) phá vỡ giả định `publish_catalog` gọi đúng một lần cho một kênh mỗi batch; (c) virtual scroll với row-height không đồng nhất (input editable + progress bar cùng dòng) là chi phí kỹ thuật thật; (d) mất khả năng luôn nhìn thấy tiến trình đang chạy khi Draft có nhiều dòng. Giữ nguyên luồng tuyến tính Đăng nhập → Chọn kênh → Workspace và giữ 2 panel tách biệt (Queue trái tối ưu virtual-scroll đồng nhất, Bảng metadata phải chuyên trị Draft).
- **Nút "Quay lại" (Workspace → Chọn kênh) dùng `CanDeactivate` guard:** nếu có Draft chưa upload hoặc task đang chạy, hiện dialog xác nhận (nêu rõ số lượng từng loại) trước khi rời. Xác nhận thì `DraftStore` bị clear, `QueueStore`/task hiện tại giữ nguyên (chạy ngầm, đồng bộ lại đúng nhờ #5 khi quay lại). `CanDeactivate` chỉ chặn điều hướng trong app — cùng logic cảnh báo phải gắn thêm vào sự kiện `onCloseRequested` của cửa sổ Tauri để chặn cả trường hợp đóng cửa sổ trực tiếp.
- **Dialog xác nhận Hạng D (re-encode toàn bộ)** đổi từ hỏi từng file riêng lẻ sang **một dialog tổng hợp có toggle/checkbox theo từng file** (mặc định checked) khi bấm "Upload (N)". Bỏ tick một file nghĩa là "không upload lúc này" — file ở lại Draft, không bị xoá khỏi bảng.

## Hệ quả

**Tích cực**
- Sửa tận gốc bug progress bar `indeterminate` ở Hạng B/C/D — khoá tương quan không còn phụ thuộc việc file bị đổi tên qua bao nhiêu bước.
- `cancel_upload` hết race huỷ nhầm file kế tiếp khi giao ca giữa hai lần upload trong queue tuần tự.
- Workspace giữ được tiến trình khi remount trong phiên sống (điều hướng đi/về không làm mất track).
- Lần đầu áp dụng tường minh bất biến CLAUDE.md về correlation id cho `tsmc-ingest-desktop` — làm mẫu cho các event mới thêm sau này (không tái dùng path làm khoá).

**Tiêu cực / phải chấp nhận**
- Breaking change chữ ký `upload_video`, `cancel_upload`, `UploadProgressDto`, `PipelineStageDto` — phải sửa đồng bộ `upload.rs`, `dto.rs`, `workspace.ts` trong cùng một PR, không thể chia nhỏ hơn mà vẫn build được.
- Thêm field `AppState.current_task` phải được cập nhật đúng ở MỌI điểm emit progress/stage (không chỉ lúc bắt đầu/kết thúc) — bỏ sót một điểm sẽ làm hydration trả dữ liệu cũ.
- Không giải quyết crash-recovery thật (đóng hẳn app giữa chừng upload) — để ngỏ, không phải phạm vi ADR này.
- Vùng code bị đổi (`upload.rs`, `ingest-grammers`) là vùng đã **verify thật bằng tài khoản Telegram** cho Hạng C/D (ADR-0017, addendum 2026-09-10/11). Đổi IPC ở đây là rủi ro hồi quy thật — cần admin tự chạy lại `cargo tauri dev` verify Hạng B/C/D bằng tài khoản thật sau khi merge (CLAUDE.md: không chạy đăng nhập MTProto hộ người dùng — agent không thể tự verify bước này).

## Việc để ngỏ

- Crash-recovery (resume upload sau khi đóng hẳn app) — không thuộc ADR này, cần thiết kế riêng nếu trở thành nhu cầu thật.
- Nếu sau này pipeline đổi sang xử lý song song nhiều file cùng lúc, mô hình "một current_task" ở đây không đủ — cần ADR riêng thiết kế registry đa tác vụ, không mở rộng ngầm quyết định này.

## Cập nhật sau khi Accepted (2026-09-13, PR2 — hydration + singleton store + guard + dialog Hạng D, code thật)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Đã code xong toàn bộ mục 5, 6 và "Quyết định kèm theo" — `cargo build`/`cargo clippy --workspace` (0 warning) + `ng build` (`apps/tsmc-ingest-desktop/ui`) sạch, dưới ngưỡng budget 500KB (321.72KB, xem chi tiết vá bundle bên dưới) — CHƯA verify bằng tài khoản Telegram thật.

**`AppState.current_task` dùng `std::sync::Mutex`, KHÔNG phải `tokio::sync::Mutex`** — quyết định thật phát sinh lúc code, không lường trước lúc viết ADR: `emit_stage()` (`pipeline.rs`) chạy trong closure ĐỒNG BỘ bên trong `spawn_blocking`, còn `on_progress` (`upload.rs`) chạy trong closure BẤT ĐỒNG BỘ trên Tokio runtime (gọi từ `async fn upload_video()` của `ingest-grammers`) — `tokio::sync::Mutex::blocking_lock()` **panic** nếu gọi từ ngữ cảnh async, nên không có MỘT kiểu khoá `tokio::sync::Mutex` nào dùng an toàn ở cả hai nơi. `std::sync::Mutex` (tay khoá luôn ngắn, không bao giờ `.await` khi đang giữ) an toàn ở cả hai ngữ cảnh — không phải sơ suất, là lựa chọn có chủ đích sau khi phát hiện ràng buộc này.

**`get_current_task()` có giới hạn thật, ghi rõ trong doc comment thay vì để ngầm:** snapshot chỉ cập nhật ở các bước Rust có emit event (`remuxing`/`reencoding`/`generating_thumbnail`/`extracting_subtitles`/`uploading_video`) — bước `uploading_subtitles` do chính Angular (`processItem()`) tự set stage, Rust không biết, nên hydrate lúc đó vẫn trả về stage `uploading_video` cuối cùng đã biết (không sai về "có việc đang chạy", chỉ có thể lệch NHÃN stage trong một cửa sổ ngắn). Chấp nhận — không đáng để thêm một command riêng chỉ để đồng bộ một nhãn hiển thị.

**`clear_current_task(task_id)` gọi từ Angular, KHÔNG phải cuối `upload_video()` (Rust):** nếu xoá ngay khi `upload_video()` trả về, hydrate trong lúc item còn đang ở bước upload phụ đề (sau video, trước khi `processItem()` xong hẳn) sẽ thấy "không có gì đang chạy" — sai hơn hẳn so với việc giữ nguyên bản ghi "uploading_video, coi như xong". `startUpload()` tự gọi `clearCurrentTask(taskId)` ngay sau khi đánh dấu item `done`/`error`.

**`QueueStore`/`DraftStore` (Angular, `core/`) chỉ giữ STATE thuần** (`items`/`uploading`/`currentTaskId`/`batchTotal`/`batchDone` dạng `signal()` trần, `providedIn: 'root'`) — KHÔNG di chuyển logic nghiệp vụ (`startUpload()`, `processItem()`, seed/kế thừa metadata...) sang service, khác dự tính ban đầu lúc thảo luận thiết kế. Lý do phát hiện lúc code: `startUpload()` là async/await JS thuần, Angular Router huỷ component KHÔNG hề huỷ theo Promise chain đang chạy dở của nó — batch vẫn tiếp tục ghi vào state dù `WorkspaceComponent` đã unmount, miễn state đó là signal root-provided (không phải local component). `workspace.ts` alias các tên biến cũ (`queue`, `uploadQueue`, `uploading`...) thẳng vào signal của store (`protected readonly queue = this.draftStore.items;`) — mọi `.set()`/`.update()` ở code cũ tiếp tục ghi đúng vào store dùng chung mà không cần đổi một dòng logic nào khác.

**Vá bug ngân sách bundle thật phát hiện lúc build** (không phải lý thuyết): thêm `inject(DialogService)` TĨNH ở `App` (root component, luôn eager) và ở `workspace-deactivate.guard.ts` (import eager qua `app.routes.ts`, không qua `loadComponent`) kéo `MatDialogModule`/`ConfirmDialog`/`GradeDDialog` vào bundle chính — `ng build` báo vượt budget 500KB (567KB). Vá bằng `import('../shared/dialog/dialog.service')` ĐỘNG tại cả hai nơi, kết hợp `runInInjectionContext(injector, () => inject(DialogService))` (injector lấy ĐỒNG BỘ trước khi `await import()`, vì `inject()` hết hợp lệ sau một `await` thật) — khôi phục đúng ranh giới lazy cũ, bundle chính về lại 321.72KB.

**Dialog Hạng D** (`shared/dialog/grade-d-dialog.ts` + `.html`/`.scss`): component mới `GradeDDialog` (danh sách `mat-checkbox`, mặc định checked, trả về `string[]` các path còn được chọn khi bấm "Xác nhận chạy"). `DialogService.confirmGradeD()` bọc thành `Promise<ReadonlySet<string>>` (tập rỗng nếu đóng dialog bằng cách khác, cùng nguyên tắc "đóng không phải xác nhận = từ chối" của `confirm()`).

**Bug thật đã gặp + vá (2026-09-13) — KHÔNG ĐÓNG ĐƯỢC APP:** user report lỗi console `"window.destroy not allowed. Permissions associated with this command: core:window:allow-destroy"` ngay sau khi thêm `onCloseRequested` ở `app.ts` (mục "Quyết định kèm theo" ở trên) — không tắt được app bằng bất kỳ cách nào. Nguyên nhân đọc thẳng `node_modules/@tauri-apps/api/window.js`: wrapper `onCloseRequested()` tự gọi `await this.destroy()` sau khi handler chạy xong NẾU handler không `preventDefault()` — tức MỌI lần đóng (kể cả nhánh không có draft/queue nào cần cảnh báo) đều cần quyền `core:window:allow-destroy`, không chỉ nhánh có dialog. `capabilities/default.json` trước đó chỉ có `core:default`, thiếu quyền này — lỗi lọt qua vì `ng build` không có cách nào bắt lỗi permission-lúc-chạy này (đây là lỗi runtime của Tauri, không phải TypeScript). Vá: thêm `"core:window:allow-destroy"` vào `capabilities/default.json`; đổi `guardWindowClose()` từ gọi `appWindow.close()` sang `appWindow.destroy()` (theo đúng doc `@tauri-apps/api/window`: `close()` chỉ emit lại `closeRequested`, `destroy()` mới thật sự đóng) — bỏ luôn cờ `closeConfirmed` chống lặp vô hạn vì `destroy()` không re-emit sự kiện nên không còn cần.

**Việc tiếp theo:** admin tự verify bằng `cargo tauri dev` + tài khoản thật — checklist mới ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--workspace-ba-vùng-bắt-đầu-upload-2026-09-12). ~~PR3 (tích hợp TMDB ở bước Draft) chưa bắt đầu.~~ Đã làm — xem [ADR-0019](./0019-tich-hop-tra-cuu-tmdb-o-buoc-draft.md).

## Cập nhật sau khi Accepted (2026-09-13, verify bug KHÔNG ĐÓNG ĐƯỢC APP — ĐẠT)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

User xác nhận bản vá `core:window:allow-destroy` + đổi `close()` → `destroy()` hoạt động đúng — đóng được app bình thường ở cả hai nhánh (có/không có draft-queue cần cảnh báo).
