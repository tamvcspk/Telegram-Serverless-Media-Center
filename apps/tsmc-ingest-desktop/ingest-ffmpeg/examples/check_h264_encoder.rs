//! Kiểm tra THẬT (không suy đoán từ configure flags) `avcodec_find_encoder`
//! thật sự trả về encoder H264 nào trên build FFmpeg đang link — cần cho
//! câu hỏi Đ2 (SPIKE-10): `reencode.rs` gọi encoder bằng dictionary đặt tên
//! `x264_opts`, nhưng vcpkg `ffmpeg:x64-windows` build với `--disable-libx264`
//! (đọc trực tiếp từ configure string nhúng trong `avcodec-61.dll`) —
//! script này xác nhận encoder THẬT được chọn là gì. Chạy: `cargo run
//! --example check_h264_encoder -p ingest-ffmpeg` (cần `FFMPEG_DIR` như
//! build bình thường).
fn main() {
    ffmpeg_next::init().expect("ffmpeg_next::init()");
    match ffmpeg_next::encoder::find(ffmpeg_next::codec::Id::H264) {
        Some(c) => println!("H264 encoder = name: {:?}, description: {:?}", c.name(), c.description()),
        None => println!("KHÔNG tìm thấy encoder H264 nào"),
    }
}
