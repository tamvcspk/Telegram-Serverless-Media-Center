//! Remux sang MP4 +faststart — port trực tiếp từ `tools/spike-09/src/main.rs::
//! remux()` (đã verify thật ở SPIKE-09/ADR-0013 § addendum 2026-09-03/04:
//! 72.1x realtime trên fixture cùng profile Hạng C). Video LUÔN stream-copy
//! (không decode/encode — vì vậy segfault đã gặp ở SPIKE-09, nằm ở nhánh
//! encode AUDIO, không xảy ra ở đây). Audio: copy nguyên (Hạng A/B, tương
//! đương `-c:a copy`) hoặc decode → encode AAC (Hạng C, tương đương
//! `apps/tsmc-ingest/src/ffmpeg.ts::remuxToMp4({ reencodeAudioToAac: true })`)
//! — cờ `reencode_audio_to_aac` do TẦNG GỌI (Tauri command) quyết định dựa
//! trên hạng đã phân loại ở TypeScript (`classifyCompatRank()`), KHÔNG tự
//! quyết ở đây (ADR-0017 điều kiện bắt buộc #4 — crate này không chứa luật
//! phân hạng).

use ffmpeg_next::{self as ffmpeg, channel_layout::ChannelLayout, codec, encoder, filter, format, frame, media::Type as MediaType, software::resampling, util::dictionary::Owned as Dictionary, Rational};

use crate::ensure_init;

enum AudioSink {
    Copy {
        out_index: i32,
    },
    Transcode {
        decoder: codec::decoder::Audio,
        encoder_ctx: codec::encoder::Audio,
        filter_graph: filter::Graph,
        dec_time_base: Rational,
        out_index: i32,
        // Bắt buộc, KHÔNG điều kiện (cùng chủ đích với `scaling::Context`
        // bắt buộc của `reencode.rs`) — chuẩn hoá MỌI frame audio giải mã
        // về đúng định dạng đã dùng để dựng `filter_graph` lúc đầu, trước
        // khi đẩy vào `abuffer`. Lý do: phát hiện thật 2026-09-15 — một
        // track AC3 thật (rip lại, không phải lỗi phía TSMC) đổi channel
        // layout GIỮA file (stereo → 5.1(side) ở khung hình cuối), trong
        // khi `ffprobe`/packet đầu chỉ thấy "stereo". `abuffer` (nguồn
        // filter graph) khoá cứng định dạng lúc dựng graph — KHÔNG hỗ trợ
        // đổi định dạng giữa chừng như video ("Changing audio frame
        // properties on the fly is not supported", nổ `AVERROR(EINVAL)`
        // = "Invalid argument" đúng như user báo). Resampler dựng lại
        // (rẻ, chỉ khi tín hiệu nguồn đổi thật) khi `resampler_src` lệch
        // với frame vừa nhận, đích luôn cố định về `norm_*` (đúng định
        // dạng graph gốc) — file KHÔNG đổi định dạng giữa chừng (đa số)
        // chỉ tốn một lượt resample gần như identity, không đổi hành vi.
        resampler: resampling::Context,
        resampler_src: (i32, format::Sample, ChannelLayout),
        norm_format: format::Sample,
        norm_channel_layout: ChannelLayout,
        norm_rate: i32,
    },
}

/// `reencode_audio_to_aac = false` → audio stream-copy y như video (khớp Hạng
/// A/B). `true` → decode → encode AAC qua filter graph (khớp Hạng C).
pub fn remux(input_path: &str, output_path: &str, reencode_audio_to_aac: bool) -> Result<(), ffmpeg::Error> {
    ensure_init();

    // +genpts: matroska demux thường để dts=None cho vài packet đầu của stream
    // có B-frame (chưa đủ lookahead để tính reorder) - mp4 muxer thì bắt buộc
    // phải có dts hợp lệ. Genpts bắt libavformat tự suy dts thay vì để trống.
    let mut in_opts = Dictionary::new();
    in_opts.set("fflags", "+genpts");
    let mut ictx = format::input_with_dictionary(input_path, in_opts)?;
    let mut octx = format::output(output_path)?;

    let mut stream_mapping = vec![-1i32; ictx.nb_streams() as usize];
    let mut ist_time_bases = vec![Rational(0, 1); ictx.nb_streams() as usize];

    let video_in_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let audio_in_index = ictx.streams().best(MediaType::Audio).ok_or(ffmpeg::Error::StreamNotFound)?.index();

    let mut ost_index = 0i32;

    // Video: add output stream, copy parameters as-is (no decode/encode).
    {
        let ist = ictx.stream(video_in_index).unwrap();
        ist_time_bases[video_in_index] = ist.time_base();
        let mut ost = octx.add_stream(encoder::find(codec::Id::None))?;
        ost.set_parameters(ist.parameters());
        unsafe {
            (*ost.parameters().as_mut_ptr()).codec_tag = 0;
        }
        stream_mapping[video_in_index] = ost_index;
        ost_index += 1;
    }

    let mut audio_sink = if !reencode_audio_to_aac {
        let ist = ictx.stream(audio_in_index).unwrap();
        ist_time_bases[audio_in_index] = ist.time_base();
        let mut ost = octx.add_stream(encoder::find(codec::Id::None))?;
        ost.set_parameters(ist.parameters());
        unsafe {
            (*ost.parameters().as_mut_ptr()).codec_tag = 0;
        }
        stream_mapping[audio_in_index] = ost_index;
        let idx = ost_index;
        ost_index += 1;
        AudioSink::Copy { out_index: idx }
    } else {
        let ist = ictx.stream(audio_in_index).unwrap();
        ist_time_bases[audio_in_index] = ist.time_base();

        let ctx = codec::context::Context::from_parameters(ist.parameters())?;
        let dec = ctx.decoder().audio()?;

        // `let codec = ...` che biến giá trị "codec" nhưng KHÔNG che module
        // `codec` (namespace giá trị/kiểu tách biệt trong Rust) — mọi
        // `codec::Xxx` (cú pháp path) bên dưới vẫn phân giải đúng về module
        // `ffmpeg_next::codec`, giống hệt cách `tools/spike-09/src/main.rs::
        // remux()` đã viết và verify chạy thật (SPIKE-09).
        let codec = encoder::find(codec::Id::AAC).ok_or(ffmpeg::Error::EncoderNotFound)?.audio()?;

        let global_header = octx.format().flags().contains(format::flag::Flags::GLOBAL_HEADER);

        let mut ost = octx.add_stream(codec)?;
        let ectx = codec::context::Context::from_parameters(ost.parameters())?;
        let mut enc = ectx.encoder().audio()?;

        let channel_layout = codec
            .channel_layouts()
            .map(|cls| cls.best(dec.channel_layout().channels()))
            .unwrap_or(ffmpeg::channel_layout::ChannelLayout::STEREO);

        if global_header {
            enc.set_flags(codec::flag::Flags::GLOBAL_HEADER);
        }
        enc.set_rate(dec.rate() as i32);
        enc.set_channel_layout(channel_layout);
        enc.set_format(codec.formats().expect("aac formats").next().unwrap());
        enc.set_bit_rate(160_000);
        enc.set_time_base((1, dec.rate() as i32));
        ost.set_time_base((1, dec.rate() as i32));

        let enc = enc.open_as(codec)?;
        ost.set_parameters(&enc);

        stream_mapping[audio_in_index] = ost_index;
        let idx = ost_index;
        ost_index += 1;

        let norm_format = dec.format();
        let norm_channel_layout = dec.channel_layout();
        let norm_rate = dec.rate() as i32;

        let args = format!(
            "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
            dec.time_base(),
            norm_rate,
            norm_format.name(),
            norm_channel_layout.bits()
        );
        let mut graph = filter::Graph::new();
        graph.add(&filter::find("abuffer").unwrap(), "in", &args)?;
        graph.add(&filter::find("abuffersink").unwrap(), "out", "")?;
        {
            let mut out = graph.get("out").unwrap();
            out.set_sample_format(enc.format());
            out.set_channel_layout(enc.channel_layout());
            out.set_sample_rate(enc.rate());
        }
        graph.output("in", 0)?.input("out", 0)?.parse("anull")?;
        graph.validate()?;

        if !codec.capabilities().contains(codec::capabilities::Capabilities::VARIABLE_FRAME_SIZE) {
            graph.get("out").unwrap().sink().set_frame_size(enc.frame_size());
        }

        let dtb = dec.time_base();
        let resampler = resampling::Context::get(norm_format, norm_channel_layout, norm_rate as u32, norm_format, norm_channel_layout, norm_rate as u32)?;
        let resampler_src = (norm_rate, norm_format, norm_channel_layout);
        AudioSink::Transcode {
            decoder: dec,
            encoder_ctx: enc,
            filter_graph: graph,
            dec_time_base: dtb,
            out_index: idx,
            resampler,
            resampler_src,
            norm_format,
            norm_channel_layout,
            norm_rate
        }
    };

    let _ = ost_index;

    octx.set_metadata(ictx.metadata().to_owned());
    let mut opts = Dictionary::new();
    opts.set("movflags", "faststart");
    octx.write_header_with(opts)?;

    for (stream, mut packet) in ictx.packets() {
        let in_index = stream.index();
        let out_index = stream_mapping[in_index];
        if out_index < 0 {
            continue;
        }
        if in_index == video_in_index {
            let ost_tb = octx.stream(out_index as usize).unwrap().time_base();
            packet.rescale_ts(ist_time_bases[in_index], ost_tb);
            packet.set_position(-1);
            packet.set_stream(out_index as usize);
            packet.write_interleaved(&mut octx)?;
        } else if in_index == audio_in_index {
            match &mut audio_sink {
                AudioSink::Copy { out_index } => {
                    let ost_tb = octx.stream(*out_index as usize).unwrap().time_base();
                    packet.rescale_ts(ist_time_bases[in_index], ost_tb);
                    packet.set_position(-1);
                    packet.set_stream(*out_index as usize);
                    packet.write_interleaved(&mut octx)?;
                }
                AudioSink::Transcode { decoder, encoder_ctx, filter_graph, dec_time_base, out_index, resampler, resampler_src, norm_format, norm_channel_layout, norm_rate } => {
                    packet.rescale_ts(ist_time_bases[in_index], *dec_time_base);
                    decoder.send_packet(&packet)?;
                    drain_audio_transcode(decoder, filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index, resampler, resampler_src, *norm_format, *norm_channel_layout, *norm_rate)?;
                }
            }
        }
    }

    if let AudioSink::Transcode { decoder, encoder_ctx, filter_graph, dec_time_base, out_index, resampler, resampler_src, norm_format, norm_channel_layout, norm_rate } = &mut audio_sink {
        decoder.send_eof()?;
        drain_audio_transcode(decoder, filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index, resampler, resampler_src, *norm_format, *norm_channel_layout, *norm_rate)?;
        filter_graph.get("in").unwrap().source().flush()?;
        drain_filter_and_encode(filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
        encoder_ctx.send_eof()?;
        drain_encoder(encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
    }

    octx.write_trailer()?;
    Ok(())
}

fn drain_encoder(encoder_ctx: &mut codec::encoder::Audio, octx: &mut format::context::Output, dec_time_base: Rational, out_index: i32) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(out_index as usize).unwrap().time_base();
    let mut encoded = ffmpeg::Packet::empty();
    while encoder_ctx.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(out_index as usize);
        encoded.rescale_ts(dec_time_base, out_tb);
        encoded.write_interleaved(octx)?;
    }
    Ok(())
}

fn drain_filter_and_encode(
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
    let mut filtered = frame::Audio::empty();
    while filter_graph.get("out").unwrap().sink().frame(&mut filtered).is_ok() {
        encoder_ctx.send_frame(&filtered)?;
        drain_encoder(encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn drain_audio_transcode(
    decoder: &mut codec::decoder::Audio,
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
    resampler: &mut resampling::Context,
    resampler_src: &mut (i32, format::Sample, ChannelLayout),
    norm_format: format::Sample,
    norm_channel_layout: ChannelLayout,
    norm_rate: i32
) -> Result<(), ffmpeg::Error> {
    let mut decoded = frame::Audio::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        let ts = decoded.timestamp();
        decoded.set_pts(ts);

        let frame_sig = (decoded.rate() as i32, decoded.format(), decoded.channel_layout());
        if frame_sig != *resampler_src {
            *resampler = resampling::Context::get(decoded.format(), decoded.channel_layout(), decoded.rate(), norm_format, norm_channel_layout, norm_rate as u32)?;
            *resampler_src = frame_sig;
        }

        let mut normalized = frame::Audio::empty();
        resampler.run(&decoded, &mut normalized)?;

        filter_graph.get("in").unwrap().source().add(&normalized)?;
        drain_filter_and_encode(filter_graph, encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}
