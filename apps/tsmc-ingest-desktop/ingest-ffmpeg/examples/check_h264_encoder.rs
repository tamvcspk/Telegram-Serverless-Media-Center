//! Khẳng định build FFmpeg đang link CÓ `libx264` (ADR-0023 — `reencode.rs`
//! tìm encoder theo TÊN, không lui về encoder khác). Trước 2026-10-10 ví dụ
//! này in encoder H264 mà `encoder::find(codec::Id::H264)` trả về — trên build
//! vcpkg `--disable-libx264` đó là `h264_mf` (phát hiện 2026-09-13).
//!
//! Thoát mã 1 nếu thiếu `libx264`, nên dùng được làm bước kiểm sau khi dựng
//! lại FFmpeg: `cargo run --example check_h264_encoder -p ingest-ffmpeg`
//! (cần `FFMPEG_DIR` như build bình thường).
fn main() {
    ffmpeg_next::init().expect("ffmpeg_next::init()");
    match ffmpeg_next::encoder::find_by_name("libx264") {
        Some(c) => println!("OK: libx264 có trong build ({:?})", c.description()),
        None => {
            println!("THIẾU libx264 — build FFmpeg này không dùng được cho re-encode (ADR-0023)");
            if let Some(c) = ffmpeg_next::encoder::find(ffmpeg_next::codec::Id::H264) {
                println!("encoder H264 khả dụng duy nhất: {:?} ({:?})", c.name(), c.description());
            }
            std::process::exit(1);
        }
    }
}
