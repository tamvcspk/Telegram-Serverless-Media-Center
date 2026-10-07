//! Chọn channel layout cho encoder AAC + chốt chặn trước `send_frame` — dùng
//! chung cho `remux()` (Hạng C) và `reencode_to_mp4()` (Hạng D).
//!
//! **Bug thật (phát hiện 2026-09-19 lúc verify Option C, vá cùng ngày):**
//! `reencode_to_mp4()` segfault (`STATUS_ACCESS_VIOLATION`, giết cả app) với
//! nguồn audio MONO. Hai lỗi chồng nhau, cùng gốc "tin `ffmpeg-next` đang áp
//! ràng buộc layout" trong khi FFmpeg 7.1 (avcodec 61.19, vcpkg) đã đổi API:
//!
//! 1. Cách chọn layout cũ — `aac.channel_layouts().map(|cls| cls.best(n))
//!    .unwrap_or(STEREO)` — luôn rơi vào `unwrap_or(STEREO)`: FFmpeg 7.1 không
//!    còn điền `AVCodec.ch_layouts` cho encoder `aac` nên `channel_layouts()`
//!    trả `None` (đo thật: `is_some=false`). Nguồn stereo chạy đúng chỉ vì
//!    TRÙNG HỢP; nguồn mono nhận encoder STEREO.
//! 2. Ràng buộc layout ở sink filter — `abuffersink.set_channel_layout()` của
//!    `ffmpeg-next` 7.1.0 set option tên `channel_layouts`, option này đã bị
//!    gỡ ở FFmpeg 7.0 (còn `ch_layouts`), và wrapper NUỐT lỗi
//!    (`let _ = ...set(...)`). Ràng buộc không bao giờ được áp → graph `anull`
//!    trả frame nguyên layout nguồn. Mono: frame 1 kênh vào encoder 2 kênh →
//!    `avcodec_send_frame` đọc con trỏ kênh 1 = NULL → segfault (đúng cơ chế
//!    [SPIKE-09 bug #3](../../../../docs/spikes/README.md#spike-09), chỉ khác
//!    nguồn gốc lệch). Nguồn 5.1: frame 6 kênh vào encoder stereo — KHÔNG crash
//!    (đủ plane) nhưng chỉ đọc hai plane đầu, sai âm thanh lặng lẽ.
//!
//! Sửa: (a) layout đích tự tính từ số kênh nguồn (1 → mono, còn lại → stereo —
//! AAC native mã hoá tốt hai layout này, downmix đa kênh về stereo là hành vi
//! Hạng C/D vẫn dự định từ đầu); (b) ép layout đó bằng filter `aformat` trong
//! chính chuỗi graph (`aformat=channel_layouts=...`, tự chèn `aresample` khi
//! cần), KHÔNG dựa vào option sink; (c) `ensure_frame_matches_encoder()` từ
//! chối cứng (trả `Err`, không segfault) nếu frame vẫn lệch số kênh với
//! encoder vì bất kỳ lý do nào khác.

use ffmpeg_next::{self as ffmpeg, channel_layout::ChannelLayout, codec, encoder, frame};

/// Layout đích của encoder AAC cho một nguồn có `source_channels` kênh, kèm tên
/// layout (cú pháp của filter `aformat`).
pub(crate) fn aac_target_layout(source_channels: i32) -> (ChannelLayout, &'static str) {
    if source_channels == 1 {
        (ChannelLayout::MONO, "mono")
    } else {
        (ChannelLayout::STEREO, "stereo")
    }
}

/// Chuỗi filter ép frame về layout đích của encoder — thay `anull` cũ.
pub(crate) fn aformat_filter_spec(layout_name: &str) -> String {
    format!("aformat=channel_layouts={layout_name}")
}

/// Chốt chặn TRƯỚC `avcodec_send_frame()`: lệch số kênh là UB phía C (segfault
/// thật, xem doc comment đầu file), nên biến thành `Err` sạch ở đây.
pub(crate) fn ensure_frame_matches_encoder(filtered: &frame::Audio, encoder_ctx: &encoder::Audio) -> Result<(), ffmpeg::Error> {
    if filtered.channel_layout().channels() != encoder_ctx.channel_layout().channels() {
        return Err(ffmpeg::Error::InvalidData);
    }
    Ok(())
}

/// Decoder một số định dạng (WMA/ASF...) khai `channel_layout` RỖNG (bits = 0) dù biết số kênh — graph `abuffer` từ chối
/// ("Invalid channel layout 0x0", lỗi Caribbean 070307-487.wmv, 2026-10-07). Điền layout mặc định theo số kênh TRƯỚC khi dựng graph.
pub(crate) fn ensure_decoder_layout(decoder: &mut codec::decoder::Audio) {
    if decoder.channel_layout().is_empty() {
        decoder.set_channel_layout(ChannelLayout::default(i32::from(decoder.channels())));
    }
}

/// Cùng lý do với `ensure_decoder_layout()`, cho từng frame đã giải mã (layout rỗng làm `resampling::Context::get` lỗi).
pub(crate) fn ensure_frame_layout(frame: &mut frame::Audio) {
    if frame.channel_layout().is_empty() {
        frame.set_channel_layout(ChannelLayout::default(i32::from(frame.channels())));
    }
}
