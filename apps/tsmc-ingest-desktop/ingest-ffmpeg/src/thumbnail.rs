//! Rút thumbnail JPEG — port trực tiếp từ `tools/spike-09/src/main.rs::
//! extract_thumbnail()` (đã verify thật ở SPIKE-09). Mặc định seek tới điểm
//! GIỮA video (`apps/tsmc-ingest/src/ffmpeg.ts::generateThumbnail()`:
//! `Math.max(1, Math.floor(durationSec / 2))`) — tầng gọi (Tauri command)
//! tính sẵn `seek_secs` bằng đúng công thức đó rồi truyền vào, không tính lại
//! ở đây (giữ một nguồn công thức, tránh lệch giữa hai chỗ).

use ffmpeg_next::{self as ffmpeg, codec, format, format::Pixel, frame, media::Type as MediaType, software::scaling};

use crate::ensure_init;

pub fn extract_thumbnail(input_path: &str, output_path: &str, seek_secs: f64, target_width: Option<u32>) -> Result<(), ffmpeg::Error> {
    ensure_init();
    let mut ictx = format::input(input_path)?;

    let stream = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?;
    let video_index = stream.index();

    let ctx = codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = ctx.decoder().video()?;

    if seek_secs > 0.0 {
        let target = (seek_secs * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;
        let target_ts = ffmpeg::rescale::Rescale::rescale(&target, (1, ffmpeg::ffi::AV_TIME_BASE), ffmpeg::rescale::TIME_BASE);
        let _ = ictx.seek(target_ts, ..target_ts);
    }

    let src_width = decoder.width();
    let src_height = decoder.height();
    let (width, height) = match target_width {
        Some(w) if w > 0 && w < src_width => {
            let h = ((src_height as u64 * w as u64) / src_width as u64) as u32;
            (w, h.max(1))
        }
        _ => (src_width, src_height)
    };
    let mut scaler = scaling::Context::get(decoder.format(), src_width, src_height, Pixel::YUVJ420P, width, height, scaling::Flags::BILINEAR)?;

    let mut got_frame: Option<frame::Video> = None;
    'outer: for (stream, packet) in ictx.packets() {
        if stream.index() != video_index {
            continue;
        }
        decoder.send_packet(&packet)?;
        let mut decoded = frame::Video::empty();
        // Chỉ cần ĐÚNG một frame — `if` thay vì `while` (một decoder video có
        // thể trả nhiều frame/packet với B-frame reorder, nhưng ta luôn lấy
        // frame ĐẦU TIÊN decode được rồi thoát ngay, không cần vòng lặp thật).
        if decoder.receive_frame(&mut decoded).is_ok() {
            let mut scaled = frame::Video::empty();
            scaler.run(&decoded, &mut scaled)?;
            got_frame = Some(scaled);
            break 'outer;
        }
    }
    let frame_to_encode = got_frame.ok_or(ffmpeg::Error::Bug)?;

    let mut octx = format::output_as(output_path, "image2")?;
    let codec = ffmpeg::encoder::find(codec::Id::MJPEG).ok_or(ffmpeg::Error::EncoderNotFound)?.video()?;
    let mut ost = octx.add_stream(codec)?;
    let ectx = codec::context::Context::from_parameters(ost.parameters())?;
    let mut enc = ectx.encoder().video()?;
    enc.set_width(width);
    enc.set_height(height);
    enc.set_format(Pixel::YUVJ420P);
    enc.set_time_base((1, 25));
    let mut enc = enc.open_as(codec)?;
    ost.set_parameters(&enc);
    ost.set_time_base((1, 25));

    octx.write_header()?;
    enc.send_frame(&frame_to_encode)?;
    enc.send_eof()?;
    let mut encoded = ffmpeg::Packet::empty();
    while enc.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(0);
        encoded.write_interleaved(&mut octx)?;
    }
    octx.write_trailer()?;
    Ok(())
}
