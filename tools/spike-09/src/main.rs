// SPIKE-09: co ffmpeg-next (native Rust FFI qua ffmpeg-sys-next) thay duoc
// shell-out CLI ffmpeg/ffprobe hien tai cua tsmc-ingest khong?
// Ba viec CLI can, do rieng tung buoc de so voi baseline 40.8x (ADR-0013):
//   remux   <input> <out.mp4>  -> copy video, encode audio sang AAC, +faststart
//   thumb   <input> <out.jpg>  -> rut 1 frame giua video, encode JPEG
//   subs    <input> <out.srt>  -> rut subtitle text track ra .srt
//   all     <input> <out_dir>  -> chay ca ba, in timing tung buoc + tong

use std::env;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use ffmpeg_next as ffmpeg;
use ffmpeg::format::{self, Pixel};
use ffmpeg::media::Type as MediaType;
use ffmpeg::software::scaling;
use ffmpeg::util::dictionary::Owned as Dictionary;
use ffmpeg::{codec, encoder, filter, frame, Rational};

fn main() {
    ffmpeg::init().expect("ffmpeg::init");
    ffmpeg::log::set_level(ffmpeg::log::Level::Warning);

    let mut args = env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| {
        eprintln!("usage: spike09 <remux|thumb|subs|all> <input> <output>");
        std::process::exit(2);
    });
    let input = args.next().expect("missing input path");

    match cmd.as_str() {
        "remux" => {
            let output = args.next().expect("missing output path");
            let copy_audio = args.any(|a| a == "--copy-audio");
            let t0 = Instant::now();
            remux(&input, &output, copy_audio).expect("remux failed");
            println!("remux: {:.3}s", t0.elapsed().as_secs_f64());
        }
        "thumb" => {
            let output = args.next().expect("missing output path");
            let seek_secs = args.next().and_then(|s| s.parse::<f64>().ok());
            let target_width = args.next().and_then(|s| s.parse::<u32>().ok());
            let t0 = Instant::now();
            extract_thumbnail(&input, &output, seek_secs, target_width).expect("thumbnail failed");
            println!("thumb: {:.3}s", t0.elapsed().as_secs_f64());
        }
        "subs" => {
            let output = args.next().expect("missing output path");
            let stream_index = args.next().and_then(|s| s.parse::<usize>().ok());
            let t0 = Instant::now();
            let n = extract_subtitles(&input, &output, stream_index).expect("subtitle extract failed");
            println!("subs: {:.3}s ({} cue)", t0.elapsed().as_secs_f64(), n);
        }
        "all" => {
            let out_dir = args.next().expect("missing output dir");
            std::fs::create_dir_all(&out_dir).expect("create out dir");
            let mp4_out = format!("{out_dir}/remuxed.mp4");
            let jpg_out = format!("{out_dir}/thumb.jpg");
            let srt_out = format!("{out_dir}/subs.srt");

            let duration_secs = probe_duration_secs(&input).expect("probe duration");
            println!("input duration: {:.3}s", duration_secs);

            let t_total = Instant::now();

            let t = Instant::now();
            remux(&input, &mp4_out, false).expect("remux failed");
            let remux_secs = t.elapsed().as_secs_f64();
            println!(
                "remux:  {:.3}s ({:.1}x realtime)",
                remux_secs,
                duration_secs / remux_secs
            );

            let t = Instant::now();
            extract_thumbnail(&input, &jpg_out, None, None).expect("thumbnail failed");
            println!("thumb:  {:.3}s", t.elapsed().as_secs_f64());

            let t = Instant::now();
            let n = extract_subtitles(&input, &srt_out, None).expect("subtitle extract failed");
            println!("subs:   {:.3}s ({} cue)", t.elapsed().as_secs_f64(), n);

            let total_secs = t_total.elapsed().as_secs_f64();
            println!(
                "TOTAL:  {:.3}s ({:.1}x realtime, so voi baseline shell-out 40.8x)",
                total_secs,
                duration_secs / total_secs
            );
        }
        other => {
            eprintln!("unknown command: {other}");
            std::process::exit(2);
        }
    }
}

fn probe_duration_secs(input: &str) -> Result<f64, ffmpeg::Error> {
    let ictx = format::input(input)?;
    let dur = ictx.duration();
    Ok(dur as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE))
}

/// Video: stream copy (khong decode). Audio: decode -> encode AAC.
/// Output mux voi movflags=faststart (yeu cau bat buoc cua Hang C, ADR-0013).
/// copy_audio=true: audio stream-copy y nhu video (khop Hang A/B cua
/// ffmpeg.ts::remuxToMp4 khi reencodeAudioToAac=false, "-c:a copy"). false:
/// decode->encode AAC qua filter graph (khop Hang C, reencodeAudioToAac=true).
fn remux(input_path: &str, output_path: &str, copy_audio: bool) -> Result<(), ffmpeg::Error> {
    // +genpts: matroska demux thuong de dts=None cho vai packet dau cua stream
    // co B-frame (chua du lookahead de tinh reorder) - mp4 muxer thi bat buoc
    // phai co dts hop le. Genpts bat libavformat tu suy dts thay vi de trong.
    let mut in_opts = Dictionary::new();
    in_opts.set("fflags", "+genpts");
    let mut ictx = format::input_with_dictionary(input_path, in_opts)?;
    let mut octx = format::output(output_path)?;

    let mut stream_mapping = vec![-1i32; ictx.nb_streams() as usize];
    let mut ist_time_bases = vec![Rational(0, 1); ictx.nb_streams() as usize];

    let video_in_index = ictx
        .streams()
        .best(MediaType::Video)
        .ok_or(ffmpeg::Error::StreamNotFound)?
        .index();
    let audio_in_index = ictx
        .streams()
        .best(MediaType::Audio)
        .ok_or(ffmpeg::Error::StreamNotFound)?
        .index();

    let mut ost_index = 0i32;

    // Video: add output stream, copy parameters as-is (no decode/encode).
    let video_out_index = {
        let ist = ictx.stream(video_in_index).unwrap();
        ist_time_bases[video_in_index] = ist.time_base();
        let mut ost = octx.add_stream(encoder::find(codec::Id::None))?;
        ost.set_parameters(ist.parameters());
        unsafe {
            (*ost.parameters().as_mut_ptr()).codec_tag = 0;
        }
        stream_mapping[video_in_index] = ost_index;
        let idx = ost_index;
        ost_index += 1;
        idx
    };

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
        },
    }

    let mut audio_sink = if copy_audio {
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
        let mut dec = ctx.decoder().audio()?;
        dec.set_parameters(ist.parameters())?;

        let codec = encoder::find(codec::Id::AAC)
            .ok_or(ffmpeg::Error::EncoderNotFound)?
            .audio()?;

        let global_header = octx
            .format()
            .flags()
            .contains(format::flag::Flags::GLOBAL_HEADER);

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

        let args = format!(
            "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
            dec.time_base(),
            dec.rate(),
            dec.format().name(),
            dec.channel_layout().bits()
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

        if !codec
            .capabilities()
            .contains(codec::capabilities::Capabilities::VARIABLE_FRAME_SIZE)
        {
            graph
                .get("out")
                .unwrap()
                .sink()
                .set_frame_size(enc.frame_size());
        }

        let dtb = dec.time_base();
        AudioSink::Transcode {
            decoder: dec,
            encoder_ctx: enc,
            filter_graph: graph,
            dec_time_base: dtb,
            out_index: idx,
        }
    };

    let _ = video_out_index;
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
                AudioSink::Transcode {
                    decoder,
                    encoder_ctx,
                    filter_graph,
                    dec_time_base,
                    out_index,
                } => {
                    packet.rescale_ts(ist_time_bases[in_index], *dec_time_base);
                    decoder.send_packet(&packet)?;
                    drain_audio_transcode(decoder, filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
                }
            }
        }
    }

    if let AudioSink::Transcode {
        decoder,
        encoder_ctx,
        filter_graph,
        dec_time_base,
        out_index,
    } = &mut audio_sink
    {
        decoder.send_eof()?;
        drain_audio_transcode(decoder, filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
        filter_graph.get("in").unwrap().source().flush()?;
        drain_filter_and_encode(filter_graph, encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
        encoder_ctx.send_eof()?;
        drain_encoder(encoder_ctx, &mut octx, *dec_time_base, *out_index)?;
    }

    octx.write_trailer()?;
    Ok(())
}

fn drain_encoder(
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
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

fn drain_audio_transcode(
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
        drain_filter_and_encode(filter_graph, encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}

/// Rut mot frame lam thumbnail, encode JPEG (mjpeg + image2 muxer). Mac dinh
/// seek toi 10% duration; truyen seek_secs de khop chinh xac midpoint that
/// cua pipeline goc (apps/tsmc-ingest/src/ffmpeg.ts: floor(durationSec/2)).
/// target_width: giu ty le khung hinh, khop `-vf scale=320:-1` cua ffmpeg.ts
/// (thumbnail catalog phai NHO, khong phai full-res).
fn extract_thumbnail(input_path: &str, output_path: &str, seek_secs: Option<f64>, target_width: Option<u32>) -> Result<(), ffmpeg::Error> {
    let mut ictx = format::input(input_path)?;

    let stream = ictx
        .streams()
        .best(MediaType::Video)
        .ok_or(ffmpeg::Error::StreamNotFound)?;
    let video_index = stream.index();
    let time_base = stream.time_base();

    let ctx = codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = ctx.decoder().video()?;

    let duration = ictx.duration();
    let target = match seek_secs {
        Some(s) => (s * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64,
        None if duration > 0 => (duration as f64 * 0.1) as i64,
        None => 0,
    };
    if target > 0 {
        let target_ts = ffmpeg::rescale::Rescale::rescale(
            &target,
            (1, ffmpeg::ffi::AV_TIME_BASE),
            ffmpeg::rescale::TIME_BASE,
        );
        let _ = ictx.seek(target_ts, ..target_ts);
    }

    let src_width = decoder.width();
    let src_height = decoder.height();
    let (width, height) = match target_width {
        Some(w) if w > 0 && w < src_width => {
            let h = ((src_height as u64 * w as u64) / src_width as u64) as u32;
            (w, h.max(1))
        }
        _ => (src_width, src_height),
    };
    let mut scaler = scaling::Context::get(
        decoder.format(),
        src_width,
        src_height,
        Pixel::YUVJ420P,
        width,
        height,
        scaling::Flags::BILINEAR,
    )?;

    let mut got_frame: Option<frame::Video> = None;
    'outer: for (stream, packet) in ictx.packets() {
        if stream.index() != video_index {
            continue;
        }
        decoder.send_packet(&packet)?;
        let mut decoded = frame::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            let mut scaled = frame::Video::empty();
            scaler.run(&decoded, &mut scaled)?;
            got_frame = Some(scaled);
            break 'outer;
        }
    }
    let frame_to_encode = match got_frame {
        Some(f) => f,
        None => return Err(ffmpeg::Error::Bug),
    };

    let mut octx = format::output_as(output_path, "image2")?;
    let codec = encoder::find(codec::Id::MJPEG)
        .ok_or(ffmpeg::Error::EncoderNotFound)?
        .video()?;
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
    let _ = time_base;
    Ok(())
}

/// Rut subtitle stream text (subrip/ass) ra file .srt. explicit_index khop
/// dung mot subtitle stream cu the (giong `-map 0:{index}` cua ffmpeg CLI,
/// dung khi file co NHIEU track phu de va can rut tung track rieng) - None
/// thi lay stream "best" (dung cho truong hop chi co 1 track).
fn extract_subtitles(input_path: &str, output_path: &str, explicit_index: Option<usize>) -> Result<usize, ffmpeg::Error> {
    let mut ictx = format::input(input_path)?;

    let sub_index = match explicit_index {
        Some(idx) => {
            let stream = ictx.stream(idx).ok_or(ffmpeg::Error::StreamNotFound)?;
            if stream.parameters().medium() != MediaType::Subtitle {
                return Err(ffmpeg::Error::StreamNotFound);
            }
            idx
        }
        None => match ictx.streams().best(MediaType::Subtitle) {
            Some(s) => s.index(),
            None => {
                File::create(output_path).ok();
                return Ok(0);
            }
        },
    };
    let time_base = ictx.stream(sub_index).unwrap().time_base();
    let params = ictx.stream(sub_index).unwrap().parameters();
    let ctx = codec::context::Context::from_parameters(params)?;
    let mut decoder = ctx.decoder().subtitle()?;

    let mut file = File::create(output_path).expect("create srt output");
    let mut n = 0usize;

    for (stream, packet) in ictx.packets() {
        if stream.index() != sub_index {
            continue;
        }
        let mut sub = ffmpeg::Subtitle::new();
        if decoder.decode(&packet, &mut sub).unwrap_or(false) {
            let mut text = String::new();
            for rect in sub.rects() {
                match rect {
                    ffmpeg::codec::subtitle::Rect::Text(t) => text.push_str(t.get()),
                    // Bat ngo: decoder subrip cua bin ffmpeg nay tra ve dang
                    // Rect::Ass, khong phai Rect::Text nhu doc doc AVSubtitleType
                    // goi y - .get() tra nguyen dong ASS Dialogue (8 truong
                    // Layer,Style,Name,MarginL,MarginR,MarginV,Effect roi moi
                    // toi Text) chu khong phai text thuan. Phai tach bo 8 truong
                    // dau + go tag override {\...} + doi \N/\n thanh xuong dong
                    // that, khac voi shell-out ffmpeg CLI (tu lam viec nay ben
                    // trong khi ghi thang ra .srt).
                    ffmpeg::codec::subtitle::Rect::Ass(a) => {
                        text.push_str(&clean_ass_text(a.get()))
                    }
                    _ => {}
                }
            }
            if text.trim().is_empty() {
                continue;
            }
            let pts = packet.pts().unwrap_or(0);
            let start_ms = rescale_to_ms(pts, time_base);
            let dur_ms = (packet.duration() as f64 * f64::from(time_base) * 1000.0) as i64;
            let end_ms = start_ms + dur_ms.max(1000);

            n += 1;
            writeln!(file, "{n}").ok();
            writeln!(
                file,
                "{} --> {}",
                fmt_srt_ts(start_ms),
                fmt_srt_ts(end_ms)
            )
            .ok();
            writeln!(file, "{}", text.trim()).ok();
            writeln!(file).ok();
        }
    }

    Ok(n)
}

/// Cat dong "Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text" cua ASS
/// xuong con Text, go tag override {\...}, doi \N/\n thanh xuong dong that.
fn clean_ass_text(raw: &str) -> String {
    let after_fields = match raw.splitn(9, ',').last() {
        Some(t) if raw.matches(',').count() >= 8 => t,
        _ => raw,
    };
    let mut out = String::with_capacity(after_fields.len());
    let mut chars = after_fields.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '}' {
                    break;
                }
            }
        } else if c == '\\' && matches!(chars.peek(), Some('N') | Some('n')) {
            chars.next();
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

fn rescale_to_ms(pts: i64, tb: Rational) -> i64 {
    (pts as f64 * f64::from(tb) * 1000.0) as i64
}

fn fmt_srt_ts(ms: i64) -> String {
    let ms = ms.max(0);
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let msec = ms % 1000;
    format!("{h:02}:{m:02}:{s:02},{msec:03}")
}

#[allow(dead_code)]
fn unused(_: &Path) {}
