//! Re-encode video THẬT (Hạng D — ADR-0013: container/codec trình duyệt
//! không giải được, remux không đủ) sang H.264/AAC MP4 +faststart. ĐẮT hơn
//! hẳn `remux()` (decode + encode VIDEO, không chỉ audio) — mockup A.2 mục 1
//! bắt buộc hỏi xác nhận TRƯỚC khi gọi hàm này (tầng gọi/Angular lo, không
//! phải ở đây).
//!
//! Khung video: port gần nguyên văn ví dụ CHÍNH THỨC của `ffmpeg-next`
//! (`examples/transcode-x264.rs` trong crate — decode → `send_frame`/
//! `receive_packet` qua `libx264`, `preset=medium` khớp
//! `apps/tsmc-ingest/src/ffmpeg.ts::reencodeToMp4()`). Khung audio: giữ
//! NGUYÊN cách dựng encoder AAC + filter graph `anull` đã verify thật ở
//! `remux.rs`/SPIKE-09 (không refactor dùng chung để tránh rủi ro đổi hành vi
//! ở một chỗ đã chứng minh chạy đúng — hai file trùng lặp một đoạn ngắn, có
//! chủ đích).
//!
//! **Rủi ro đã ghi ở ADR-0013 § addendum 2026-09-03 áp dụng NGUYÊN VẸN ở
//! đây, khác `remux()`/`extract_thumbnail()`/`extract_subtitles()`:** đây là
//! lần ĐẦU TIÊN crate này gọi `avcodec_send_frame()` cho VIDEO (encode thật,
//! không chỉ audio) — segfault đã gặp ở SPIKE-09 nằm ở audio, nhưng cùng
//! LỚP rủi ro (buffer/format mismatch khi encode) có thể lặp lại ở video.
//!
//! **Sửa sau phát hiện thật (2026-09-12, user report "invalid argument" khi
//! re-encode một file Hạng D thật):** bản đầu gán THẲNG
//! `encoder.set_format(decoder.format())`/kích thước gốc — `avcodec_open2`
//! của `libx264` từ chối (a) pixel format decoder trả về nếu KHÁC 4:2:0
//! phẳng chuẩn (vd `yuvj420p` dải đủ của nhiều file MJPEG/AVI cũ, hay
//! 4:2:2/4:4:4 của vài codec khác) — CLI shell-out cũ không gặp lỗi này vì
//! `ffmpeg` binary tự chèn ngầm một bước `scale`/`format` filter khi cần,
//! native API thì KHÔNG tự làm hộ; (b) chiều rộng/cao LẺ (4:2:0 cần chẵn cả
//! hai chiều để chia đôi chroma) — một số AVI cũ có kích thước lẻ thật. Vá
//! bằng MỘT `scaling::Context` bắt buộc (không điều kiện — luôn chạy, kể cả
//! khi định dạng nguồn tình cờ đã là `yuv420p`, để không phải đoán "trường
//! hợp nào cần") ép mọi frame về đúng `Pixel::YUV420P` + kích thước làm tròn
//! XUỐNG số chẵn gần nhất (mất tối đa 1px mỗi chiều, không đáng kể so với
//! rủi ro lỗi cứng) TRƯỚC khi đưa vào encoder — cùng pattern đã dùng ở
//! `thumbnail.rs`, chỉ khác là dùng cho MỌI frame của cả video, không phải
//! một frame duy nhất.

use ffmpeg_next::{self as ffmpeg, codec, encoder, filter, format, format::Pixel, frame, media::Type as MediaType, software::scaling, util::dictionary::Owned as Dictionary, Rational};

use crate::ensure_init;

/// 4:2:0 (chroma nửa độ phân giải cả hai chiều) yêu cầu width/height CHẴN —
/// làm tròn XUỐNG số chẵn gần nhất, không làm tròn LÊN (tránh vẽ thêm viền
/// ngoài khung hình gốc).
fn round_down_even(value: u32) -> u32 {
    value & !1
}

pub fn reencode_to_mp4(input_path: &str, output_path: &str) -> Result<(), ffmpeg::Error> {
    ensure_init();

    let mut in_opts = Dictionary::new();
    in_opts.set("fflags", "+genpts");
    let mut ictx = format::input_with_dictionary(input_path, in_opts)?;
    let mut octx = format::output(output_path)?;

    let video_in_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let audio_in_index = ictx.streams().best(MediaType::Audio).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let video_ist_time_base = ictx.stream(video_in_index).unwrap().time_base();
    let audio_ist_time_base = ictx.stream(audio_in_index).unwrap().time_base();

    let global_header = octx.format().flags().contains(format::flag::Flags::GLOBAL_HEADER);

    // --- Video: decode -> scale (chuẩn hoá format/kích thước) -> encode H.264
    // (khung port từ examples/transcode-x264.rs của chính ffmpeg-next, thêm
    // bước scale sau phát hiện thật — xem doc comment đầu file) ---
    let video_dec_ctx = codec::context::Context::from_parameters(ictx.stream(video_in_index).unwrap().parameters())?;
    let mut video_decoder = video_dec_ctx.decoder().video()?;

    const ENC_PIXEL_FORMAT: Pixel = Pixel::YUV420P;
    let enc_width = round_down_even(video_decoder.width()).max(2);
    let enc_height = round_down_even(video_decoder.height()).max(2);
    let mut video_scaler = scaling::Context::get(
        video_decoder.format(),
        video_decoder.width(),
        video_decoder.height(),
        ENC_PIXEL_FORMAT,
        enc_width,
        enc_height,
        scaling::Flags::BILINEAR
    )?;

    let h264 = encoder::find(codec::Id::H264);
    let mut vost = octx.add_stream(h264)?;
    let mut video_enc_ctx = codec::context::Context::new_with_codec(h264.ok_or(ffmpeg::Error::EncoderNotFound)?).encoder().video()?;
    video_enc_ctx.set_height(enc_height);
    video_enc_ctx.set_width(enc_width);
    video_enc_ctx.set_aspect_ratio(video_decoder.aspect_ratio());
    video_enc_ctx.set_format(ENC_PIXEL_FORMAT);
    video_enc_ctx.set_frame_rate(video_decoder.frame_rate());
    video_enc_ctx.set_time_base(video_ist_time_base);
    if global_header {
        video_enc_ctx.set_flags(codec::flag::Flags::GLOBAL_HEADER);
    }
    let mut x264_opts = ffmpeg::Dictionary::new();
    x264_opts.set("preset", "medium");
    let mut video_encoder = video_enc_ctx.open_with(x264_opts)?;
    vost.set_parameters(&video_encoder);
    let video_out_index = 0i32;

    // --- Audio: decode -> filter (anull) -> encode AAC (giữ NGUYÊN cách dựng của remux.rs/SPIKE-09) ---
    let audio_ist_params = ictx.stream(audio_in_index).unwrap().parameters();
    let audio_dec_ctx = codec::context::Context::from_parameters(audio_ist_params)?;
    let mut audio_decoder = audio_dec_ctx.decoder().audio()?;

    let aac = encoder::find(codec::Id::AAC).ok_or(ffmpeg::Error::EncoderNotFound)?.audio()?;
    let mut aost = octx.add_stream(aac)?;
    let aectx = codec::context::Context::from_parameters(aost.parameters())?;
    let mut audio_enc_ctx = aectx.encoder().audio()?;

    let channel_layout = aac
        .channel_layouts()
        .map(|cls| cls.best(audio_decoder.channel_layout().channels()))
        .unwrap_or(ffmpeg::channel_layout::ChannelLayout::STEREO);

    if global_header {
        audio_enc_ctx.set_flags(codec::flag::Flags::GLOBAL_HEADER);
    }
    audio_enc_ctx.set_rate(audio_decoder.rate() as i32);
    audio_enc_ctx.set_channel_layout(channel_layout);
    audio_enc_ctx.set_format(aac.formats().expect("aac formats").next().unwrap());
    audio_enc_ctx.set_bit_rate(160_000);
    audio_enc_ctx.set_time_base((1, audio_decoder.rate() as i32));
    aost.set_time_base((1, audio_decoder.rate() as i32));

    let mut audio_encoder = audio_enc_ctx.open_as(aac)?;
    aost.set_parameters(&audio_encoder);
    let audio_out_index = 1i32;

    let args = format!(
        "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
        audio_decoder.time_base(),
        audio_decoder.rate(),
        audio_decoder.format().name(),
        audio_decoder.channel_layout().bits()
    );
    let mut audio_filter = filter::Graph::new();
    audio_filter.add(&filter::find("abuffer").unwrap(), "in", &args)?;
    audio_filter.add(&filter::find("abuffersink").unwrap(), "out", "")?;
    {
        let mut out = audio_filter.get("out").unwrap();
        out.set_sample_format(audio_encoder.format());
        out.set_channel_layout(audio_encoder.channel_layout());
        out.set_sample_rate(audio_encoder.rate());
    }
    audio_filter.output("in", 0)?.input("out", 0)?.parse("anull")?;
    audio_filter.validate()?;
    if !aac.capabilities().contains(codec::capabilities::Capabilities::VARIABLE_FRAME_SIZE) {
        audio_filter.get("out").unwrap().sink().set_frame_size(audio_encoder.frame_size());
    }
    let audio_dec_time_base = audio_decoder.time_base();

    octx.set_metadata(ictx.metadata().to_owned());
    let mut header_opts = Dictionary::new();
    header_opts.set("movflags", "faststart");
    octx.write_header_with(header_opts)?;

    for (stream, packet) in ictx.packets() {
        let in_index = stream.index();
        if in_index == video_in_index {
            video_decoder.send_packet(&packet)?;
            drain_video(&mut video_decoder, &mut video_scaler, &mut video_encoder, &mut octx, video_ist_time_base, video_out_index)?;
        } else if in_index == audio_in_index {
            let mut packet = packet;
            packet.rescale_ts(audio_ist_time_base, audio_dec_time_base);
            audio_decoder.send_packet(&packet)?;
            drain_audio_decoder(&mut audio_decoder, &mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;
        }
    }

    // Flush video: decoder -> scaler -> encoder.
    video_decoder.send_eof()?;
    drain_video(&mut video_decoder, &mut video_scaler, &mut video_encoder, &mut octx, video_ist_time_base, video_out_index)?;
    video_encoder.send_eof()?;
    drain_video_encoder(&mut video_encoder, &mut octx, video_ist_time_base, video_out_index)?;

    // Flush audio: decoder -> filter -> encoder.
    audio_decoder.send_eof()?;
    drain_audio_decoder(&mut audio_decoder, &mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;
    audio_filter.get("in").unwrap().source().flush()?;
    drain_audio_filter_and_encode(&mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;
    audio_encoder.send_eof()?;
    drain_audio_encoder(&mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;

    octx.write_trailer()?;
    Ok(())
}

fn drain_video(
    decoder: &mut codec::decoder::Video,
    scaler: &mut scaling::Context,
    encoder_ctx: &mut encoder::Video,
    octx: &mut format::context::Output,
    ist_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
    let mut decoded = frame::Video::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        let ts = decoded.timestamp();
        // `scaler.run()` sinh frame MỚI (không giữ pts của frame nguồn) —
        // phải gán lại pts SAU khi scale, không phải trước.
        let mut scaled = frame::Video::empty();
        scaler.run(&decoded, &mut scaled)?;
        scaled.set_pts(ts);
        encoder_ctx.send_frame(&scaled)?;
        drain_video_encoder(encoder_ctx, octx, ist_time_base, out_index)?;
    }
    Ok(())
}

fn drain_video_encoder(encoder_ctx: &mut encoder::Video, octx: &mut format::context::Output, ist_time_base: Rational, out_index: i32) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(out_index as usize).unwrap().time_base();
    let mut encoded = ffmpeg::Packet::empty();
    while encoder_ctx.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(out_index as usize);
        encoded.rescale_ts(ist_time_base, out_tb);
        encoded.write_interleaved(octx)?;
    }
    Ok(())
}

fn drain_audio_encoder(encoder_ctx: &mut codec::encoder::Audio, octx: &mut format::context::Output, dec_time_base: Rational, out_index: i32) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(out_index as usize).unwrap().time_base();
    let mut encoded = ffmpeg::Packet::empty();
    while encoder_ctx.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(out_index as usize);
        encoded.rescale_ts(dec_time_base, out_tb);
        encoded.write_interleaved(octx)?;
    }
    Ok(())
}

fn drain_audio_filter_and_encode(
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
    let mut filtered = frame::Audio::empty();
    while filter_graph.get("out").unwrap().sink().frame(&mut filtered).is_ok() {
        encoder_ctx.send_frame(&filtered)?;
        drain_audio_encoder(encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}

fn drain_audio_decoder(
    decoder: &mut codec::decoder::Audio,
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
    let mut decoded = frame::Audio::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        let ts = decoded.timestamp();
        decoded.set_pts(ts);
        filter_graph.get("in").unwrap().source().add(&decoded)?;
        drain_audio_filter_and_encode(filter_graph, encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}
