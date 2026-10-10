# encode-bench

Bộ đo chất lượng re-encode Hạng D — [ADR-0023 § 4c.1](../../docs/adr/0023-libx264-cho-re-encode-hang-d-chap-nhan-gpl-cho-ingest.md). Mọi slice 4c sau đo bằng cùng công cụ này để số liệu so sánh được với nhau và với bảng trong ADR.

Không thuộc app, không có phụ thuộc npm — chỉ `node` + một `ffmpeg` CLI **bản full** có `libx264` và `libvmaf` (không phải bản vcpkg đóng gói cùng app; trên máy dev là bản WinGet `Gyan.FFmpeg`, xem memory `dev-machine-encoders`).

## Dùng

```powershell
$env:TSMC_BENCH_FFMPEG = "C:\...\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

# 1. Dựng clip tham chiếu: 3 đoạn 20 s ở 1800/5400/9000 s, giải mã ra FFV1 lossless (~700 MB cho 1080p).
node tools/encode-bench/encode-bench.mjs ref --source D:\co\phim.wmv --out D:\bench

# 2. Chạy ma trận (mặc định `builtin`, ngân sách 1450 kbps = ~2 GB / 3 giờ).
node tools/encode-bench/encode-bench.mjs run --ref D:\bench\ref.mkv --kbps 1450
node tools/encode-bench/encode-bench.mjs run --ref D:\bench\ref.mkv --only x264_fast_crf22_cap,x264_fast_2pass

# 3. Phân bổ bit theo thời gian: bitrate từng cửa sổ 3 s so với độ khó cảnh.
node tools/encode-bench/encode-bench.mjs trace --dir D:\bench --complexity x264_fast_crf22_cap --names mf_abr,x264_fast_2pass
```

`npm run` nuốt `--flag` — luôn gọi thẳng `node`.

## Đọc kết quả

| Cột | Ý nghĩa |
|---|---|
| `kbps` | bitrate video thực tế của file ra (dung lượng / thời lượng tham chiếu) |
| `vmaf` / `hmean` | VMAF trung bình / trung bình điều hoà (hmean phạt khung tệ nặng hơn) |
| `p5` / `p1` | VMAF của 5% / 1% khung tệ nhất — **chỉ số quyết định**: `h264_mf` có trung bình khá nhưng p1 ≈ 31 (vỡ nét thấy bằng mắt), x264 p1 ≈ 71 |
| `speedX` | thời lượng tham chiếu / thời gian encode (gồm cả pass 1 với 2-pass) — đọc thẳng FFV1, nhanh hơn đọc nguồn nén |

`trace` in `tương quan với độ khó`: gần 1 = encoder dồn bit cho cảnh khó (x264 2-pass ≈ 0.95); gần 0 = chia đều bất kể nội dung (`h264_mf` ≈ 0.05).

## Giới hạn

- VMAF không đo được phần psy-rd của x264, có khi còn phạt nó — **không chỉnh `psy`/`tune` theo VMAF**.
- Clip tham chiếu ngắn (60 s) và một nguồn; ghi rõ nguồn khi trích số vào ADR.
- `h264_mf` ở ma trận là mốc lịch sử; build ffmpeg CLI không có `h264_mf` thì cấu hình đó báo lỗi và bị bỏ qua.
- Tệp ra (`*.mp4`, `*.vmaf.json`, `*-pass*`) nằm cạnh `ref.mkv` — để ngoài repo.
