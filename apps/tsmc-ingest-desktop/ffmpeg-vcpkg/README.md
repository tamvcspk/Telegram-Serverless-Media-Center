# FFmpeg có x264 cho ingest desktop

[ADR-0023](../../../docs/adr/0023-libx264-cho-re-encode-hang-d-chap-nhan-gpl-cho-ingest.md): re-encode Hạng D dùng `libx264`, nên `ingest-ffmpeg` cần FFmpeg build `--enable-gpl --enable-libx264`. Bản `vcpkg install ffmpeg:x64-windows` mặc định (LGPL, chỉ có `h264_mf`) **không đủ** — app báo `EncoderMissing`.

`vcpkg.json` cạnh file này ghim `ffmpeg 7.1.1#1` (`ffmpeg-sys-next` 7.1.3 chưa nhận FFmpeg 8/9) trên một `builtin-baseline` đủ mới.

## Dựng

Cần: Git, MSVC Build Tools, NASM trên `PATH` (x264 dùng assembly), mạng.

```powershell
# 1. Một checkout vcpkg RIÊNG — không nâng cấp vcpkg đang dùng chung.
#    --reference mượn object từ vcpkg có sẵn (nhanh); bỏ --reference nếu chưa có.
git clone --reference C:\vcpkg --dissociate https://github.com/microsoft/vcpkg C:\vcpkg-gpl\vcpkg
C:\vcpkg-gpl\vcpkg\bootstrap-vcpkg.bat -disableMetrics

# 2. Dựng theo manifest (≈ 20 phút trên máy 16 luồng).
$env:VCPKG_ROOT = "C:\vcpkg-gpl\vcpkg"
C:\vcpkg-gpl\vcpkg\vcpkg.exe install `
  --vcpkg-root=C:\vcpkg-gpl\vcpkg `
  --x-manifest-root=apps\tsmc-ingest-desktop\ffmpeg-vcpkg `
  --x-install-root=C:\vcpkg-gpl\installed `
  --triplet=x64-windows
```

Kết quả ở `C:\vcpkg-gpl\installed\x64-windows`: `bin\` có 8 DLL runtime (`avcodec-61`, `avdevice-61`, `avfilter-10`, `avformat-61`, `avutil-59`, `swscale-8`, `swresample-5`, **`libx264-165`**).

## Dùng

```powershell
$env:FFMPEG_DIR = "C:\vcpkg-gpl\installed\x64-windows"
Remove-Item Env:PKG_CONFIG_PATH -ErrorAction SilentlyContinue   # cây cũ còn trong PATH pkg-config thì crate vẫn link bản cũ
$env:PATH = "C:\vcpkg-gpl\installed\x64-windows\bin;$env:PATH"  # chạy example/dev cần DLL
cargo run --release --example check_h264_encoder -p ingest-ffmpeg   # phải in "OK: libx264 có trong build"
```

Đổi `FFMPEG_DIR` làm `ffmpeg-sys-next` build lại (`rerun-if-env-changed`); dùng `CARGO_TARGET_DIR` riêng nếu phải luân phiên hai bản.

## Vì sao không chỉ thêm `gpl,x264` vào cây vcpkg cũ

vcpkg 2025-04-07 ghim gói MSYS2 `libtool-2.4.7-4` mà mirror MSYS2 đã xoá (HTTP 404 ở cả sáu mirror) — port `x264` không dựng được, retry vô ích. Cần vcpkg mới hơn; checkout riêng tránh đổi phiên bản của mọi thư viện khác đang dùng. Ghi ở [lessons](../../../docs/lessons.md).

## Giấy phép

Bản này là **GPL-2.0-or-later** (x264). Nghĩa vụ chỉ phát sinh khi đưa `.exe` ingest desktop cho người khác (kèm mã nguồn hoặc lời mời cung cấp). `apps/web` không bị ảnh hưởng — chương trình riêng.
