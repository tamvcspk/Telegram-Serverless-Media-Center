//! Đo (1) mức SÀN dung lượng của `h264_mf` `rate_control=quality` khi q thấp, và
//! (2) độ lệch giữa ngoại suy từ các đoạn thử (mặc định 3 đoạn 8s ở 20/50/80%,
//! cùng cách `estimate_reencode()`) và dung lượng encode CẢ file — cho từng chế
//! độ (ABR `abr:<bps>` hoặc `q:<0-100>`). Bổ sung `check_mf_rate_control` (đo
//! chất lượng).
//!
//! Streaming (decode → scale bilinear → encode, chỉ cộng byte packet, không
//! mux, không audio) nên chạy được cả phim dài mà không nạp frame vào RAM; số
//! byte là video thuần (container ~1-2% thêm vào CẢ HAI phía nên không đổi độ lệch).
//!
//! Chạy: `cargo run --release --example check_quality_sampling -p ingest-ffmpeg --
//! <input> <max_height> <sample|full> <spec[,spec...]>` — vd spec `q:0,q:10,abr:3000000`.
//! `full` chỉ nhận MỘT spec. Biến môi trường (chỉ chế độ `sample`): `SAMPLE_LEN`
//! (giây, mặc định 8) và `SAMPLE_POS` (tỉ lệ thời lượng, phân tách bằng dấu phẩy,
//! mặc định `0.2,0.5,0.8`) để thử độ nhạy của ngoại suy.

use std::time::Instant;

use ffmpeg_next::{self as ffmpeg, codec, encoder, format, format::Pixel, frame, media::Type as MediaType, software::scaling, Dictionary};

fn sample_len_sec() -> f64 {
    std::env::var("SAMPLE_LEN").ok().and_then(|s| s.parse().ok()).unwrap_or(8.0)
}

fn sample_positions() -> Vec<f64> {
    std::env::var("SAMPLE_POS").ok().map(|s| s.split(',').filter_map(|p| p.parse().ok()).collect()).unwrap_or_else(|| vec![0.2, 0.5, 0.8])
}

struct Run {
    bytes: u64,
    media_sec: f64,
    wall_sec: f64,
}

fn sample_starts(duration_sec: f64) -> Vec<f64> {
    let len = sample_len_sec();
    sample_positions().iter().map(|p| (duration_sec * p).min(duration_sec - len).max(0.0)).collect()
}

fn encode(input: &str, window: Option<(f64, f64)>, max_height: u32, spec: &str) -> Result<Run, ffmpeg::Error> {
    let (kind, val) = spec.split_once(':').unwrap_or((spec, "0"));
    let mut ictx = format::input(input)?;
    if let Some((start, _)) = window {
        if start > 0.0 {
            let ts = (start * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;
            let _ = ictx.seek(ts, ..ts);
        }
    }
    let stream = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?;
    let v_index = stream.index();
    let tb = f64::from(stream.time_base());
    let fps_r = stream.avg_frame_rate();
    let fps = if fps_r.denominator() != 0 { f64::from(fps_r) } else { 25.0 };
    let fps_i = fps.round().max(1.0) as i32;
    let mut decoder = codec::context::Context::from_parameters(stream.parameters())?.decoder().video()?;

    let scale = if decoder.height() > max_height { max_height as f64 / decoder.height() as f64 } else { 1.0 };
    let (w, h) = (((decoder.width() as f64 * scale) as u32) & !1, ((decoder.height() as f64 * scale) as u32) & !1);
    let mut scaler = scaling::Context::get(decoder.format(), decoder.width(), decoder.height(), Pixel::YUV420P, w, h, scaling::Flags::BILINEAR)?;

    // Đo ĐÚNG `h264_mf` (không phải "encoder H264 nào đó": build có x264 sẽ trả libx264 — ADR-0023).
    let h264 = encoder::find_by_name("h264_mf").ok_or(ffmpeg::Error::EncoderNotFound)?;
    let mut ctx = codec::context::Context::new_with_codec(h264).encoder().video()?;
    ctx.set_width(w);
    ctx.set_height(h);
    ctx.set_format(Pixel::YUV420P);
    ctx.set_time_base((1, fps_i));
    ctx.set_frame_rate(Some((fps_i, 1)));
    ctx.set_gop(fps_i as u32 * 2);
    let mut dict = Dictionary::new();
    match kind {
        "abr" => ctx.set_bit_rate(val.parse().expect("bps")),
        "q" => {
            dict.set("rate_control", "quality");
            dict.set("quality", val);
        }
        _ => panic!("spec không hợp lệ: {spec}"),
    }
    let mut enc = ctx.open_with(dict)?;

    let began = Instant::now();
    let (mut bytes, mut frames) = (0u64, 0u64);
    let mut packet = ffmpeg::Packet::empty();
    let mut decoded = frame::Video::empty();
    let end = window.map(|(s, l)| s + l);
    let start = window.map(|(s, _)| s).unwrap_or(0.0);
    'outer: for (s, pkt) in ictx.packets() {
        if s.index() != v_index {
            continue;
        }
        decoder.send_packet(&pkt)?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            let t = decoded.timestamp().unwrap_or(0) as f64 * tb;
            if t < start {
                continue; // decode-only sau seek lùi keyframe
            }
            if end.is_some_and(|e| t >= e) {
                break 'outer;
            }
            let mut scaled = frame::Video::empty();
            scaler.run(&decoded, &mut scaled)?;
            scaled.set_pts(Some(frames as i64));
            enc.send_frame(&scaled)?;
            frames += 1;
            while enc.receive_packet(&mut packet).is_ok() {
                bytes += packet.size() as u64;
            }
        }
    }
    enc.send_eof()?;
    while enc.receive_packet(&mut packet).is_ok() {
        bytes += packet.size() as u64;
    }
    Ok(Run { bytes, media_sec: frames as f64 / fps_i as f64, wall_sec: began.elapsed().as_secs_f64() })
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 5 {
        eprintln!("usage: check_quality_sampling <input> <max_height> <sample|full> <spec[,spec...]>");
        std::process::exit(2);
    }
    ffmpeg::init().expect("ffmpeg::init");
    ffmpeg::log::set_level(ffmpeg::log::Level::Error);
    let (input, max_height, mode) = (&a[1], a[2].parse::<u32>().expect("max_height"), a[3].as_str());
    let duration = ingest_ffmpeg::probe(input).expect("probe").duration_sec;

    for spec in a[4].split(',') {
        match mode {
            "full" => {
                let r = encode(input, None, max_height, spec).expect("encode full");
                println!("FULL   {spec:<14} {:>12} B  {:>7.0} kbps  media {:.0}s  tuong {:.0}s", r.bytes, r.bytes as f64 * 8.0 / r.media_sec / 1000.0, r.media_sec, r.wall_sec);
            }
            _ => {
                let (mut b, mut m, mut w) = (0u64, 0f64, 0f64);
                let mut kbps = Vec::new();
                for start in sample_starts(duration) {
                    let r = encode(input, Some((start, sample_len_sec())), max_height, spec).expect("encode mau");
                    kbps.push(r.bytes as f64 * 8.0 / r.media_sec / 1000.0);
                    b += r.bytes;
                    m += r.media_sec;
                    w += r.wall_sec;
                }
                println!(
                    "SAMPLE {spec:<14} ngoai suy {:>12.0} B  {:>6.0} kbps  ({} doan: {})  {:.1}x realtime",
                    b as f64 / m * duration,
                    b as f64 * 8.0 / m / 1000.0,
                    kbps.len(),
                    kbps.iter().map(|k| format!("{k:.0}")).collect::<Vec<_>>().join("/"),
                    m / w
                );
            }
        }
    }
}
