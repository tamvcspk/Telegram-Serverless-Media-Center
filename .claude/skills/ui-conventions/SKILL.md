---
name: ui-conventions
description: Convention cho code UI trong apps/web (Angular zoneless) — cấu trúc thư mục/file, khi nào dùng SignalStore vs signal() trần, ranh giới đọc/ghi dữ liệu, convention comment đầu file, và luật routing cho màn hình mới. Dùng khi tạo component/store mới trong apps/web, hoặc khi review code UI xem có đúng pattern đã thống nhất không.
---

# ui-conventions

Convention này đúc từ pattern đã tự hình thành qua 4 slice đã chạy thật (F1–F4: Auth, Sync, Index, Browse, Playback). Phần lớn là **ghi lại luật ngầm đã có trong code**, không phải luật mới áp đặt — khi có mâu thuẫn giữa skill này và code hiện tại, ưu tiên đọc lại code trước vì đây có thể là chỗ convention đã trôi.

Nền tảng bắt buộc đọc trước: [ADR-0002](../../../docs/adr/0002-angular-zoneless-signals-va-signalstore.md) (zoneless/signals/SignalStore), [ADR-0012](../../../docs/adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md) (ranh giới workspace), [ADR-0016](../../../docs/adr/0016-angular-material-va-cdk.md) (Material/CDK).

## 1. Cấu trúc thư mục & file

```
app/<feature>/
  <feature>.ts          # component — KHÔNG suffix .component
  <feature>.html
  <feature>.scss
  <feature>.store.ts    # chỉ khi thật sự cần SignalStore, xem mục 2
  <sub-widget>/          # dialog/con riêng của feature này
app/shell/
  <layout>.ts            # layout route component (bottom nav, sub-page header…), xem mục 6
  <name>.guard.ts         # route guard, cùng chỗ với layout vì gắn chặt vào routing
```

Ví dụ đã có: `browse/browse.ts` + `browse/browse.store.ts`; `sync/state-channel-resolution-dialog/` là sub-widget riêng của `sync/`.

- Không suffix `.component`/`.service` — khớp Angular 22 và đã nhất quán 100% trong code hiện tại.
- Selector `app-*`.
- **Chưa tạo `app/shared/`.** Đợi tới khi có ≥2 feature cần cùng một widget (banner cảnh báo, empty-state…) mới tách — rule-of-three, tránh trừu tượng hoá sớm. Đây là chuyện KHÁC với `app/shell/` ở mục 6 — shell là component layout gắn với route (bottom nav, header quay lại…), không phải widget dùng chung, nên không chờ rule-of-three.

## 2. State scope — 3 tầng

| Tầng | Chứa gì | Cơ chế | Ví dụ |
|---|---|---|---|
| **Nguồn sự thật** | Domain data (phim, sync state) | `liveQuery()` từ `@tsmc/core-storage` → `toSignal(from(...))`. Không bao giờ copy vào store. | `browse.ts` (`rows`), `player.ts` (`syncState`) |
| **Query/UI state của feature** | filter, sort, bước wizard, dialog mở/đóng — nhiều phần trong 1 feature cùng đọc/ghi | `@ngrx/signals` SignalStore, `providers: [XStore]` ở component | `BrowseStore` — chỉ giữ `sourceId/query/sort`, KHÔNG giữ mảng phim |
| **UI state cục bộ 1 component** | loading flag, hover, toggle không ai khác cần | `signal()` field trần trong class — **không** tạo store | `sync-status.ts` — `flushing`, `writingTest` là `signal()` trần |

**Luật chọn tầng 2 vs 3:** nếu không có component/child nào khác cần inject state đó → đừng tạo store. `sync-status.ts` là bằng chứng ngược lại cám dỗ "cứ có vài field thì tạo store cho gọn" — đây là chỗ dễ over-engineer nhất trong UI layer, cẩn thận khi review.

Ghi (mutation) dữ liệu **đã persist** luôn qua `createCoreWorkerClient()` (RPC vào Core Worker). `patchState()` chỉ dùng cho state tạm/UI — không bao giờ dùng để giả lập ghi domain data.

## 3. Component conventions

- `standalone` ngầm định + `changeDetection: OnPush` viết tường minh mọi lần, không dựa vào default.
- `imports: []` theo từng Material module (`MatChipsModule`, `MatFormFieldModule`…), không import gói tổng. CDK ưu tiên trước Material khi chỉ cần overlay/a11y/virtual-scroll thuần (ADR-0016 §Quyết định 3).
- **Trước khi dùng một component Material có icon mặc định** (`MatStepper`, và bất kỳ component nào khác sau này): kiểm tra nó có gọi `<mat-icon>ligature-name</mat-icon>` hay không — dự án không nhúng font Material Symbols/Icons (bất biến #8), ligature sẽ render ra CHỮ THÔ bị cắt cụt, không phải icon vỡ mà là icon KHÔNG CÓ FONT. Override qua cơ chế chính thức của component (vd `<ng-template matStepperIcon="done">` + SVG inline), không cố nhúng font. Phát hiện thật + chi tiết: [ADR-0016 addendum 2026-08-27](../../../docs/adr/0016-angular-material-va-cdk.md#cập-nhật-sau-khi-accepted-2026-08-27-slice-ui-login).
- **`MatStepper [linear]="true"` không hợp với việc lái `selectedIndex`/`completed` bằng binding qua signal** (không `stepControl`) — có race điều kiện thật (Angular set input của `<mat-stepper>` cha trước `<mat-step>` con trong cùng một lượt CD, gate đọc `completed` cũ). Dùng `stepControl` thật (Reactive Forms) nếu cần `linear`, hoặc tắt `linear` và tự chặn điều hướng ngược bằng `[editable]="false"` (không phụ thuộc `linear`). Chi tiết: ADR-0016 addendum ở trên.
- DI qua `inject()`, không dùng constructor param.
- **`inject()` chỉ hợp lệ khi hàm còn chạy ĐỒNG BỘ trong injection context** — gọi SAU một `await` (kể cả trong guard/resolver/effect async) ném `NG0203`. Triệu chứng dễ gây lạc hướng: không phải lỗi rõ ràng trên UI, mà là "điều hướng/thao tác đứng im" nếu không có try/catch bọc ngoài bắt được reject. Gọi HẾT mọi `inject()` cần dùng ngay đầu hàm, trước `await` đầu tiên, kể cả khi giá trị đó chỉ dùng ở nhánh code phía sau. Bug thật gặp ở `shell/auth.guard.ts` (`inject(MatDialog)` từng đặt sau `await client.restoreSession()` — sửa 2026-08-27).
- Field visibility: `protected readonly` nếu template chạm tới, `private readonly` nếu chỉ nội bộ dùng — cả `browse.ts`, `player.ts`, `sync-status.ts` đều theo đúng mẫu này.
- Ưu tiên `toSignal`/`toObservable` hơn `.subscribe()` thủ công. Nếu bắt buộc subscribe tay → `takeUntilDestroyed()`.
- `@for` bắt buộc có `track`; `@defer` cho khối nặng (player, ffmpeg.wasm).

## 4. Comment đầu file — convention riêng của repo này

Quy tắc chung của dự án là mặc định không viết comment. Nhưng UI layer đã tự đóng đinh một convention khác, áp dụng nhất quán ở mọi file feature đã có: **mở đầu bằng JSDoc tiếng Việt** nêu slice (`F#.#`), ADR liên quan, và đúng MỘT lý do "tại sao" mà người đọc không tự suy ra được nếu chỉ đọc code (vd lý do một thứ tự gọi hàm bắt buộc, một race condition đã gặp thật). Đây không phải comment thừa — nó *là* phần WHY ở granularity file, phục vụ truy vết provenance khi nhiều slice chồng lên nhau. Giữ convention này, đừng xoá theo luật mặc định chung của dự án.

Không viết comment mô tả WHAT (code đã tự nói), không viết comment nhắc lại tên slice trong thân hàm — chỉ ở đầu file và ở đúng chỗ có quyết định non-obvious (xem ví dụ `PROGRESS_SAVE_INTERVAL_MS`, `SERVICE_WORKER_READY_TIMEOUT_MS` trong `player/player.ts`).

## 5. Ranh giới truy cập dữ liệu

- Đọc: `liveQuery` từ `@tsmc/core-storage`.
- Ghi/RPC: `createCoreWorkerClient()` từ `@tsmc/worker-host`.
- Không component/store nào import `core-mtproto`/`core-download` trực tiếp — `eslint-plugin-boundaries` chặn theo ADR-0012, nhưng đừng thử "tạm tắt rule" để lấy đường tắt; nếu cảm thấy cần import thẳng, đó là dấu hiệu logic đang thuộc về `worker-host`, không phải `apps/web`.

## 6. Routing & layout — KHÔNG có một `AppShell` chung cho mọi màn hình

Đã implement (2026-08-27, xem `app.routes.ts`): `login` (Auth, full-bleed) → `home` (gate bằng `authGuard`, `MainShell` + 3 route con `browse`/`collections`/`sources`) → `player/:sourceId/:msgId` (immersive, không đổi từ F4). `docs/ux-design.md` (bản mobile-first) xác nhận layout khác nhau thật sự theo TỪNG NHÓM màn hình — đừng quay lại sai lầm "bọc hết vào một `AppShell`" của bản trước đó. Bốn nhóm layout, ứng với 4 cách route khác nhau:

| Nhóm | Màn hình | Layout | Cách route |
|---|---|---|---|
| **Auth** | Màn 1 (Login) | Full-bleed, cuộn dọc, không chrome | Route đơn `login`, không cha layout |
| **Main shell** | Màn 2/3/4 (Dashboard/Collections/Sources) | Bottom nav cố định dưới cùng, 3 tab | Route cha `home` (`shell/main-shell.ts`, `canActivate: [authGuard]`) có `<router-outlet>`, 3 route con lazy |
| **Immersive** | Màn 5 (Player) | Toàn màn hình, KHÔNG chrome (không toolbar, không bottom nav) | Route đơn `player/:sourceId/:msgId`, không cha layout — "không cần layout wrapper" là một lựa chọn hợp lệ, đừng tự bịa một cái |
| **Sub-page** | Màn 6/7 (Metadata Editor, Settings) | Header `<` quay lại, có thể có sticky bottom bar (Metadata Editor) | **Chưa route** — chưa có UI thật, xem CLAUDE.md. Khi thêm: route đơn hoặc cha layout header dùng chung nếu ≥2 sub-page giống hệt nhau (rule-of-three như `app/shared/` ở mục 1) |

**Bottom nav của `MainShell` tự ghép bằng `routerLink`/`routerLinkActive` thường** (`shell/main-shell.html`) — KHÔNG phải `MatBottomNav`, component đó không tồn tại trong Angular Material (đã xác nhận bằng cách liệt kê thư mục cài đặt thật). Đừng đi tìm module Material nào cho việc này.

**`authGuard` (`shell/auth.guard.ts`) là nơi DUY NHẤT gọi `initSync()`** trong toàn app — guard chạy lại MỖI LẦN điều hướng tới `home` (kể cả quay lại từ `/player`), mà `initSync()` không an toàn gọi hai lần (đăng ký thêm leader-change listener, hydrate lại từ đầu — xem `libs/core-sync/src/sync-engine.ts`), nên guard cache kết quả bằng một `Promise` cấp module. Nếu thêm logic "phải chạy đúng một lần mỗi trang" tương tự, dùng lại đúng pattern này, đừng rải ra nhiều component.

**Sync/Browse/Index đã dọn khỏi `login.html`** (khác hiện trạng ghi trong bản skill trước) — `Browse` chạy thật trong tab `home/browse`; `SyncStatus`/`ChannelIndex` (công cụ debug) tạm host trong tab `home/sources` (`sources/sources.ts` — có comment đầu file ghi rõ đây là chỗ tạm, xoá khi Màn hình 4 thật được build); `Collections` là placeholder trống chờ Màn hình 3.

**Luật chung cho mọi màn hình cấp cao mới:** route thật + `loadComponent` lazy, đúng mẫu đã có ở F4. Trước khi thêm route, tự hỏi nó thuộc nhóm nào trong bảng trên — đừng mặc định nhét vào `MainShell` chỉ vì đó là chỗ "đã có sẵn".
