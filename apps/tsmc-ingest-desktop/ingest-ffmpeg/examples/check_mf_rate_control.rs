//! Kiểm tra THẬT các chế độ rate control của `h264_mf` (MediaFoundation) —
//! encoder H264 duy nhất của app này (build vcpkg tắt `libx264`, xem doc
//! comment đầu `reencode.rs`) — để đánh đổi chất lượng/dung lượng giữa các chế
//! độ: ABR (`set_bit_rate`, như production), `pc_vbr` và `rate_control=quality`
//! (không bitrate). Mỗi chế độ chạy ở nhiều mức (quét bitrate / quét q) để dựng
//! ĐƯỜNG CONG bitrate-chất lượng — so một điểm đơn lẻ giữa các chế độ vô nghĩa
//! vì dung lượng khác nhau.
//!
//! Example CHỈ encode + mux ra `<out_dir>/<tên>.mp4` rồi in `tên<TAB>byte<TAB>
//! giây-media<TAB>đỉnh-1s-kbps`. Chấm điểm (VMAF) và so với x264 do script
//! ngoài làm (cần ffmpeg CLI có `libvmaf`; số x264 chỉ là số tham chiếu dev, không
//! đưa vào app). Đầu vào PHẢI là clip đã cắt/hạ độ phân giải sẵn (lossless, ví
//! dụ FFV1) — example không scale/seek để mọi encoder cùng nhận đúng một đầu vào.
//!
//! Chạy: `cargo run --release --example check_mf_rate_control -p ingest-ffmpeg --
//! <clip> <out_dir> [base_bps=1500000]`

use std::time::Instant;

use ffmpeg_next::{self as ffmpeg, codec, encoder, format, format::Pixel, frame, media::Type as MediaType, Dictionary, Rational};

struct Config {
    name: String,
    bit_rate: Option<usize>,
    opts: Vec<(&'static str, String)>,
}

struct Measured {
    bytes: u64,
    media_sec: f64,
    peak_kbps_1s: f64,
    wall_sec: f64,
}

fn load_frames(input: &str) -> Result<(Vec<frame::Video>, i32, u32, u32), ffmpeg::Error> {
    let mut ictx = format::input(input)?;
    let stream = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?;
    let v_index = stream.index();
    let fps_r = stream.avg_frame_rate();
    let fps = if fps_r.denominator() != 0 { f64::from(fps_r) } else { 25.0 };
    let mut decoder = codec::context::Context::from_parameters(stream.parameters())?.decoder().video()?;
    let (w, h) = (decoder.width(), decoder.height());
    let mut frames = Vec::new();
    let mut decoded = frame::Video::empty();
    for (s, packet) in ictx.packets() {
        if s.index() != v_index {
            continue;
        }
        decoder.send_packet(&packet)?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            frames.push(decoded.clone());
        }
    }
    decoder.send_eof()?;
    while decoder.receive_frame(&mut decoded).is_ok() {
        frames.push(decoded.clone());
    }
    Ok((frames, fps.round().max(1.0) as i32, w, h))
}

fn drain(enc: &mut encoder::Video, octx: &mut format::context::Output, enc_tb: Rational, last_dts: &mut Option<i64>, buckets: &mut [u64], fps_i: i32) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(0).unwrap().time_base();
    let mut packet = ffmpeg::Packet::empty();
    while enc.receive_packet(&mut packet).is_ok() {
        let sec = (packet.pts().or(packet.dts()).unwrap_or(0) as f64 / fps_i as f64).max(0.0) as usize;
        if let Some(b) = buckets.get_mut(sec) {
            *b += packet.size() as u64;
        }
        packet.set_stream(0);
        packet.rescale_ts(enc_tb, out_tb);
        // Cùng cách bơm dts của `reencode.rs::drain_video_encoder`.
        if let Some(dts) = packet.dts() {
            let fixed = match *last_dts {
                Some(prev) if dts <= prev => prev + 1,
                _ => dts,
            };
            if fixed != dts {
                packet.set_dts(Some(fixed));
                if packet.pts().is_none_or(|p| p < fixed) {
                    packet.set_pts(Some(fixed));
                }
            }
            *last_dts = Some(fixed);
        }
        packet.write_interleaved(octx)?;
    }
    Ok(())
}

fn encode_config(frames: &[frame::Video], fps_i: i32, w: u32, h: u32, cfg: &Config, out_path: &str) -> Result<Measured, ffmpeg::Error> {
    // Đo ĐÚNG `h264_mf` (không phải "encoder H264 nào đó": build có x264 sẽ trả libx264 — ADR-0023).
    let h264 = encoder::find_by_name("h264_mf").ok_or(ffmpeg::Error::EncoderNotFound)?;
    let mut octx = format::output(out_path)?;
    let global_header = octx.format().flags().contains(format::flag::Flags::GLOBAL_HEADER);
    let enc_tb = Rational::new(1, fps_i);

    let mut enc_ctx = codec::context::Context::new_with_codec(h264).encoder().video()?;
    enc_ctx.set_width(w);
    enc_ctx.set_height(h);
    enc_ctx.set_format(Pixel::YUV420P);
    enc_ctx.set_time_base(enc_tb);
    enc_ctx.set_frame_rate(Some((fps_i, 1)));
    enc_ctx.set_gop(fps_i as u32 * 2);
    if global_header {
        enc_ctx.set_flags(codec::flag::Flags::GLOBAL_HEADER);
    }
    if let Some(bps) = cfg.bit_rate {
        enc_ctx.set_bit_rate(bps);
    }
    let mut dict = Dictionary::new();
    for (k, v) in &cfg.opts {
        dict.set(k, v);
    }
    let mut enc = enc_ctx.open_with(dict)?;
    {
        let mut vost = octx.add_stream(h264)?;
        vost.set_parameters(&enc);
    }
    octx.write_header()?;

    let began = Instant::now();
    let mut buckets = vec![0u64; frames.len() / fps_i.max(1) as usize + 2];
    let mut last_dts = None;
    for (i, f) in frames.iter().enumerate() {
        let mut f = f.clone();
        f.set_pts(Some(i as i64));
        f.set_kind(ffmpeg::picture::Type::None);
        enc.send_frame(&f)?;
        drain(&mut enc, &mut octx, enc_tb, &mut last_dts, &mut buckets, fps_i)?;
    }
    enc.send_eof()?;
    drain(&mut enc, &mut octx, enc_tb, &mut last_dts, &mut buckets, fps_i)?;
    octx.write_trailer()?;
    let wall_sec = began.elapsed().as_secs_f64();

    let full = (frames.len() / fps_i.max(1) as usize).max(1);
    let peak = buckets.iter().take(full).copied().max().unwrap_or(0) as f64 * 8.0 / 1000.0;
    let bytes = std::fs::metadata(out_path).map(|m| m.len()).unwrap_or(0);
    Ok(Measured { bytes, media_sec: frames.len() as f64 / fps_i as f64, peak_kbps_1s: peak, wall_sec })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: check_mf_rate_control <clip> <out_dir> [base_bps]");
        std::process::exit(2);
    }
    ffmpeg::init().expect("ffmpeg::init");
    ffmpeg::log::set_level(ffmpeg::log::Level::Error);
    let (input, out_dir) = (&args[1], &args[2]);
    let base: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1_500_000.0);
    std::fs::create_dir_all(out_dir).expect("tạo out_dir");

    let (frames, fps_i, w, h) = load_frames(input).expect("đọc clip");
    eprintln!("clip: {} frame {w}x{h}@{fps_i}fps", frames.len());

    // Quét bitrate quanh `base` (ABR + pc_vbr) và quét q (quality).
    let mults = [0.4, 0.7, 1.0, 1.5, 2.5, 4.0];
    let mut configs = Vec::new();
    for m in mults {
        let bps = (base * m) as usize;
        configs.push(Config { name: format!("mf_abr_{}", bps / 1000), bit_rate: Some(bps), opts: vec![] });
    }
    for m in mults {
        let bps = (base * m) as usize;
        configs.push(Config { name: format!("mf_pcvbr_{}", bps / 1000), bit_rate: Some(bps), opts: vec![("rate_control", "pc_vbr".into())] });
    }
    for q in [20, 30, 40, 50, 60, 70, 80] {
        configs.push(Config { name: format!("mf_quality_{q}"), bit_rate: None, opts: vec![("rate_control", "quality".into()), ("quality", q.to_string())] });
    }

    for cfg in &configs {
        let out_path = format!("{out_dir}/{}.mp4", cfg.name);
        match encode_config(&frames, fps_i, w, h, cfg, &out_path) {
            Ok(m) => println!("{}\t{}\t{:.3}\t{:.0}\t{:.1}", cfg.name, m.bytes, m.media_sec, m.peak_kbps_1s, m.wall_sec),
            Err(e) => eprintln!("{}: LỖI {e}", cfg.name),
        }
    }
}
