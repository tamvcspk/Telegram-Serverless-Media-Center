# `tsmc-ingest` — CLI admin đưa phim vào kho

CLI chạy trên **máy admin** (không phải trong trình duyệt) để đưa video vào một kênh media TSMC: kiểm tra khả năng phát được trước khi tốn băng thông, remux/encode nếu cần, rút phụ đề, sinh thumbnail, rồi upload qua chính tài khoản MTProto của admin và ghi entry vào `catalog.json`. Lý do tồn tại + ràng buộc kỹ thuật (bot Telegram không thể upload phim, tại sao compat phải quyết ở lúc upload chứ không phải lúc xem...): [ADR-0013](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md).

> **KHÔNG chạy CLI này hộ ai bằng agent/AI.** Lệnh `login` là đăng nhập MTProto thật — session tương đương toàn quyền tài khoản Telegram của bạn (đọc/gửi tin nhắn, xoá tài khoản). Luôn tự chạy trong terminal của chính bạn.

## Yêu cầu trước khi dùng

- Node.js ≥ 22 (đã cần cho cả repo).
- `ffmpeg` + `ffprobe` trên `PATH` — CLI shell-out thẳng ra hai binary này, không có fallback nào khác:
  - Windows: `winget install ffmpeg` (hoặc Chocolatey/Scoop)
  - macOS: `brew install ffmpeg`
  - Linux: `apt install ffmpeg` (hoặc package tương đương của distro)
- `TSMC_API_ID` + `TSMC_API_HASH` — tự tạo tại https://my.telegram.org (credential do chính bạn cấp cho tài khoản của bạn, không phải bí mật server nào — CLAUDE.md bất biến #1).

## Cài đặt lần đầu

Từ **gốc repo** (nơi có `pnpm-workspace.yaml`):

```bash
pnpm install                 # nếu chưa cài dependency cho cả workspace
npm run build:ingest         # esbuild → apps/tsmc-ingest/dist/cli.js
```

Sau đó chuyển vào thư mục `apps/tsmc-ingest/` — **mọi lệnh CLI bên dưới đều chạy từ đây**, vì `.env` và session cục bộ đều đọc/ghi tương đối theo thư mục hiện hành lúc chạy:

```bash
cd apps/tsmc-ingest
cp .env.example .env         # rồi điền TSMC_API_ID/TSMC_API_HASH thật
```

`.env` đã bị `.gitignore` chặn — không commit file này. Có thể điền thêm `TSMC_PHONE_NUMBER` (định dạng quốc tế, vd `+84912345678`) để lệnh `login` bỏ qua prompt nhập số điện thoại mỗi lần chạy lại; mã OTP thì luôn phải gõ tay (dùng một lần, không lưu được).

## Các lệnh

Chạy từ `apps/tsmc-ingest/`:

```bash
node dist/cli.js login
node dist/cli.js probe <file...>
node dist/cli.js upload --channel <ref> [--yes] <file...>
```

(Muốn gõ tắt `tsmc-ingest` thay vì `node dist/cli.js` thì `npm link` trong thư mục này — không bắt buộc, `package.json` đã khai `bin`.)

### `login`

Đăng nhập MTProto (phone → mã xác nhận Telegram gửi qua app → mật khẩu 2FA nếu tài khoản có bật) qua prompt terminal. Session mã hoá (AES-GCM) được lưu ở `~/.tsmc-ingest/session.local.json` — **ngoài repo hoàn toàn**, không phải chỉ dựa vào `.gitignore`. Chạy lại `login` những lần sau sẽ tự khôi phục session cũ, không hỏi lại phone/mã (đã verify thật).

### `probe <file...>`

Chỉ chạy `ffprobe` + phân hạng khả năng phát (A/B/C/D) rồi in ra — **không upload, không cần đăng nhập**. Dùng để xem trước một file có cần remux/re-encode không, trước khi cam kết upload thật.

```bash
node dist/cli.js probe "path/to/Movie.mkv"
```

### `upload --channel <ref> [--yes] <file...>`

Pipeline đầy đủ cho từng file, theo đúng thứ tự:

```text
probe → phân hạng A/B/C/D → (remux hoặc re-encode nếu cần)
      → rút + upload phụ đề text → sinh thumbnail
      → prompt/kế thừa metadata → upload video → gộp + publish catalog.json
```

- `--channel <ref>` — **bắt buộc**. Username hoặc invite link của kênh (Kho Cá Nhân do chính bạn tạo — CLI chặn upload vào kênh không phải của bạn). Không dùng ID số thô (`access_hash` khác nhau theo tài khoản, xem CLAUDE.md bất biến #10).
- `--yes` (hoặc `-y`) — bỏ qua MỌI xác nhận/prompt (kế thừa metadata mặc định "có", re-encode Hạng D mặc định "tiếp tục", không hỏi sửa Title/Năm). Dùng cho batch nhiều file không muốn ngồi canh terminal.
- Có thể truyền nhiều file cùng lúc — publish `catalog.json` chỉ diễn ra **một lần** sau khi cả batch xong, không phải mỗi file một lần (giảm cửa sổ rủi ro `FLOOD_WAIT` giữa chuỗi RPC ghi catalog).

```bash
node dist/cli.js upload --channel my_media_channel "Movie.2024.mkv"
node dist/cli.js upload --channel my_media_channel --yes "S01E01.mkv" "S01E02.mkv"
```

## Bảng phân hạng khả năng phát (A/B/C/D)

Quyết định remux hay re-encode dựa vào container + codec probe được — chi tiết đầy đủ ở [ADR-0013 mục 1](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md#1-tsmc-ingest--cli-chạy-trên-máy-admin-nơi-upload-thật-sự-diễn-ra):

| Hạng | Điều kiện | CLI làm gì |
|---|---|---|
| 🟢 A | MP4/MOV + H.264 + AAC + `faststart` | Chuẩn hoá `+faststart` rồi upload thẳng |
| 🟡 B | MP4 + HEVC/AV1, hoặc audio Opus/E-AC-3 | Upload, đánh dấu `compat: "partial"` trong catalog |
| 🟠 C | MKV/TS + H.264/HEVC, audio DTS/TrueHD/PGS subs | **Remux** sang MP4 (copy video, encode audio → AAC), rút phụ đề ra riêng |
| 🔴 D | AVI, VC-1, RealVideo, codec trình duyệt không giải được | Cần **re-encode video** (đắt, chậm) — CLI báo thời lượng ước tính và **luôn hỏi xác nhận** trước khi chạy, kể cả với `--yes` chỉ bỏ qua prompt chứ không đổi việc phải encode |

Nguyên tắc xuyên suốt: remux (copy stream) là mặc định vì rẻ và không mất chất lượng; re-encode luôn đắt nên không bao giờ được âm thầm tự chạy.

## Phụ đề

CLI gộp phụ đề từ **hai nguồn**, cả hai đều tự động — không có flag nào để chỉ định phụ đề trên dòng lệnh, ví dụ `upload` ở trên chỉ truyền file video là đủ:

- **Phụ đề NHÚNG trong video** (track subtitle bên trong MKV, chỉ rút ở Hạng C — Hạng A/B đã phát được thẳng, hiếm khi cần rút subs rời):
  - Dạng **text** (SRT/ASS/SSA nhúng) → CLI tự rút ra `.srt` rồi upload thành document rời, ghi vào `subs[]`.
  - Dạng **ảnh** (PGS/`.sup`, DVD sub) → CLI chỉ rút ra file cục bộ (thư mục tạm, xoá sau khi lệnh chạy xong) rồi **không** upload, vì trình duyệt không tự render `.sup` như một text track. Cần dùng thì tự convert (OCR) sang `.srt` bằng công cụ khác rồi đăng tay.
- **Phụ đề NGOÀI đặt cạnh file video** — CLI tự dò file cùng thư mục, theo đúng quy ước phổ biến của Plex/Jellyfin/Kodi:
  - `<tên video>.srt` (không phân biệt ngôn ngữ), hoặc
  - `<tên video>.<mã ngôn ngữ 2-3 ký tự>.srt` (vd `.vi.srt`, `.en.srt`) — cũng nhận `.vtt`.

  Ví dụ: có sẵn `Movie.2024.mkv` + `Movie.2024.vi.srt` + `Movie.2024.en.srt` trong cùng thư mục, chỉ cần chạy:

  ```bash
  node dist/cli.js upload --channel my_media_channel "Movie.2024.mkv"
  ```

  cả hai file `.srt` được tự phát hiện, upload, và ghi vào `subs[]` cùng video — **không cần liệt kê chúng trên dòng lệnh**. Chỉ nhận `.srt`/`.vtt` (text thuần) — `.ass`/`.ssa` chưa hỗ trợ (cần convert mới dùng được, giống lý do PGS/`.sup` không tự upload).

Cả hai nguồn đều gộp chung vào `subs[]` của catalog item — không phân biệt trong dữ liệu lưu, chỉ khác ở chỗ CLI tìm ra chúng bằng cách nào.

## Kế thừa metadata cho series

Khi upload nhiều tập cùng series (không dùng `--yes`), CLI hỏi có muốn "kế thừa metadata" từ item vừa upload trước đó không — nếu có, `season`/`episode` tự tăng, `title`/`series.name`/năm/thể loại giữ nguyên từ item trước, chỉ cần xác nhận hoặc sửa đè Title/Năm nếu sai. Việc "gộp" catalog (không ghi đè mất item cũ) đã verify đúng trên tài khoản thật với nhiều lần upload liên tiếp.

## Bảo mật & nơi lưu dữ liệu

- Session MTProto mã hoá: `~/.tsmc-ingest/session.local.json` — ngoài repo, không commit được dù có lỡ tay.
- `.env` (API_ID/API_HASH/số điện thoại tuỳ chọn): `apps/tsmc-ingest/.env`, đã `.gitignore`.
- File tạm lúc xử lý (remux, thumbnail, phụ đề rút ra): thư mục tạm hệ điều hành, tự xoá sau khi lệnh `upload` chạy xong (kể cả khi lỗi giữa chừng).

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `Cần ffmpeg + ffprobe trên PATH` | Chưa cài, hoặc cài nhưng chưa có trong `PATH` của terminal đang dùng — mở terminal mới sau khi cài, hoặc kiểm bằng `ffmpeg -version`/`ffprobe -version` |
| `Thiếu --channel <ref>` | Quên truyền `--channel`, hoặc truyền sau danh sách file (parser đọc theo thứ tự, `--channel <ref>` nên đứng ngay sau `upload`) |
| `Không tìm thấy kênh "..."` | Sai username/invite link, hoặc tài khoản đăng nhập chưa là thành viên/chủ kênh đó |
| Lỗi kiểu "chỉ chủ kênh mới upload được" | Kênh không phải Kho Cá Nhân do chính bạn tạo (ADR-0014 §4) — CLI chặn ghi vào kênh media của người khác |
| Chạy `login` lại nhưng vẫn hỏi phone/mã dù đã đăng nhập trước đó | Kiểm tra `~/.tsmc-ingest/session.local.json` có tồn tại/đọc được không; nếu máy/user hệ điều hành đổi, session cũ có thể không còn truy cập được |
| Muốn xem chi tiết đã verify thật những gì, còn thiếu gì | [docs/pending-device-tests.md](../../docs/pending-device-tests.md) — checklist verify trên tài khoản/kênh thật, cập nhật theo từng lần chạy thật |
