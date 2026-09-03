# SPIKE-09 — ffmpeg-next (Rust FFI) vs shell-out ffmpeg/ffprobe

Xem [docs/spikes/README.md#spike-09](../../docs/spikes/README.md#spike-09) cho câu hỏi, tiêu chí, và kết quả đầy đủ.

Crate Rust độc lập, **không** nối vào pnpm workspace của repo. Bốn lệnh con,
khớp đúng ba việc `tsmc-ingest` CLI cần (`apps/tsmc-ingest/src/ffmpeg.ts`):

```bash
# copy video, +faststart. Mac dinh encode audio AAC (khop Hang C); them
# --copy-audio de giu nguyen audio (khop Hang A/B, "-c:a copy")
cargo run --release -- remux <input> <out.mp4> [--copy-audio]

# rut 1 frame lam thumbnail, encode JPEG. seek_secs mac dinh 10% duration;
# width mac dinh giu nguyen do phan giai (khop -vf scale=W:-1 khi truyen)
cargo run --release -- thumb <input> <out.jpg> [seek_secs] [width]

# rut subtitle text/ASS ra .srt. stream_index mac dinh lay track "best"
# (dung khi chi co 1 track); truyen index de khop -map 0:{index}
cargo run --release -- subs <input> <out.srt> [stream_index]

cargo run --release -- all <input> <out_dir>   # ca 3 viec (thong so mac dinh), in timing + tong
```

## Prerequisite (đã có sẵn trên máy dùng để chạy spike này)

- `vcpkg install ffmpeg:x64-windows` (dynamic triplet — build 6 lib cần: avcodec/avdevice/avfilter/avformat/avutil/swscale)
- LLVM/libclang (`bindgen` cần để build `ffmpeg-sys-next`)
- MSVC Build Tools

```bash
export FFMPEG_DIR="C:/vcpkg/installed/x64-windows"
export LIBCLANG_PATH="C:/Program Files/LLVM/bin"
cargo build --release
```

## Chạy binary — cần đúng 7 DLL, không phải 6

**Phát hiện thật (2026-09-04, xem [ADR-0013 § Cập nhật 2026-09-04](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-04-tích-hợp-thật-vào-tsmc-ingest--sửa-số-liệu-đóng-gói-ở-addendum-trên)):** `spike09.exe` KHÔNG chỉ cần 6 DLL nó gọi trực tiếp — `avcodec-61.dll` tự nó phụ thuộc thêm `swresample-5.dll` (transitive, `objdump` trên chính `spike09.exe` không thấy được). Thiếu file này → thoát mã `0xC0000135` (`STATUS_DLL_NOT_FOUND`) — **không phải segfault**, dễ nhầm nếu chỉ nhìn "thoát mã khác 0".

**Cách khuyến nghị — copy đủ 7 DLL cạnh `.exe` (tự chứa, không cần set `PATH`):**

```bash
DLLS="C:/vcpkg/installed/x64-windows/bin"
OUT="target/release"
for f in avcodec-61.dll avdevice-61.dll avfilter-10.dll avformat-61.dll avutil-59.dll swscale-8.dll swresample-5.dll; do
  cp "$DLLS/$f" "$OUT/$f"
done
```

Cách khác — thêm `C:/vcpkg/installed/x64-windows/bin` vào `PATH` của terminal/process gọi `spike09.exe` (Windows tìm DLL theo thứ tự: thư mục chứa `.exe` trước, `PATH` sau — copy DLL vào thư mục `.exe` luôn thắng, đáng tin hơn nhớ set `PATH` mỗi lần).

## Fixture (tự sinh, không commit — xem `.gitignore`)

File mẫu thật dùng cho baseline 40.8x (`[KST.VN].The.Big.Bang.Theory...mkv`)
là file thiết bị thật của admin, không có trong repo. Fixture ở đây là
**proxy tổng hợp** cùng profile Hạng C (MKV + H.264 1280x720 + AC3 stereo +
phụ đề `.srt` rời gộp vào track), sinh bằng `ffmpeg` cục bộ:

```bash
ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=25:duration=300" \
       -f lavfi -i "sine=frequency=440:duration=300" \
       -c:v libx264 -preset veryfast -pix_fmt yuv420p \
       -c:a ac3 -b:a 192k -ac 2 \
       fixtures/video_audio.mkv
ffmpeg -i fixtures/video_audio.mkv -i fixtures/sub.srt \
       -map 0 -map 1 -c copy -c:s srt \
       fixtures/sample.mkv
```

`fixtures/sub.srt` (2 dòng phụ đề mẫu) đã có sẵn trong repo — nhẹ, không
phải media nhị phân.

**Cảnh báo đã trả giá bằng một segfault thật:** `sine=` không kèm `-ac 2` chỉ
sinh audio **mono**. Pipeline remux ở đây suy channel layout của encoder AAC
từ `dec.channel_layout().channels()` của audio nguồn — nếu số kênh đó không
khớp buffer frame cấp cho encoder, `avcodec_send_frame()` segfault thẳng tay
(exit code 139 / `STATUS_ACCESS_VIOLATION` trên Windows), không trả
`Result::Err`. Khác hẳn lỗi thiếu DLL ở mục trên (`0xC0000135`) — hai loại lỗi
native FFI khác nhau, đừng gộp làm một khi debug. Xem chi tiết ở addendum
ADR-0013 tương ứng (2026-09-03 cho segfault, 2026-09-04 cho DLL).
