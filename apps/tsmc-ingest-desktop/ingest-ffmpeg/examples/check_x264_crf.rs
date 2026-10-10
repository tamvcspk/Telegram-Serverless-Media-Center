//! Verify re-encode THẬT bằng `libx264` qua `reencode_with_options()` (ADR-0023 § 4c.1): CRF + trần
//! VBV, và ABR để so. In dung lượng, bitrate, thời gian và tốc độ x-realtime — số tốc độ này là
//! thứ ADR ghi "đo lại trong app sau khi bật đa luồng".
//!
//! Chạy: `cargo run --release --example check_x264_crf -p ingest-ffmpeg -- <input> <out_dir> [rf] [maxrate_kbps] [start_sec len_sec]`
//! (cần FFMPEG_DIR trỏ tới FFmpeg có x264 và thư mục `bin` của nó trong PATH.)
//! Bỏ trống `start_sec len_sec` = encode cả file.

use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: check_x264_crf <input> <out_dir> [rf=22] [maxrate_kbps=0] [start_sec len_sec]");
        std::process::exit(2);
    }
    let input = &args[1];
    let out_dir = &args[2];
    let rf: f32 = args.get(3).map_or(22.0, |v| v.parse().expect("rf"));
    let maxrate_kbps: u64 = args.get(4).map_or(0, |v| v.parse().expect("maxrate_kbps"));
    let window = match (args.get(5), args.get(6)) {
        (Some(s), Some(l)) => Some((s.parse::<f64>().expect("start"), l.parse::<f64>().expect("len"))),
        _ => None,
    };

    let probe = ingest_ffmpeg::probe(input).expect("probe");
    let media_sec = window.map_or(probe.duration_sec, |(_, l)| l);
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let on_progress = |_: ingest_ffmpeg::PipelineProgress| {};
    let bufsize_bits = maxrate_kbps * 1000 * 2;

    let run = |label: &str, options: ingest_ffmpeg::ReencodeOptions| {
        let out = format!("{out_dir}/{label}.mp4");
        let began = Instant::now();
        ingest_ffmpeg::reencode_with_options(input, &out, &options, probe.duration_sec, &on_progress, &cancel).unwrap_or_else(|e| panic!("{label}: {e}"));
        let wall = began.elapsed().as_secs_f64();
        let bytes = std::fs::metadata(&out).expect("stat").len();
        let out_probe = ingest_ffmpeg::probe(&out).expect("probe out");
        let v = out_probe.video.expect("video out");
        println!(
            "{label:>10}: {:>10} byte · {:>6.0} kbps tổng · {}x{} {} · {wall:>6.1}s · {:.2}x thời gian thực",
            bytes,
            bytes as f64 * 8.0 / media_sec / 1000.0,
            v.width,
            v.height,
            v.codec,
            media_sec / wall
        );
    };

    println!("encoder: {} · preset: {}", ingest_ffmpeg::VIDEO_ENCODER_NAME, ingest_ffmpeg::DEFAULT_X264_PRESET);
    run(
        "crf",
        ingest_ffmpeg::ReencodeOptions {
            crf: Some(ingest_ffmpeg::CrfRate { rf, maxrate_bps: maxrate_kbps * 1000, bufsize_bits }),
            window,
            ..Default::default()
        },
    );
    if maxrate_kbps > 0 {
        run("abr", ingest_ffmpeg::ReencodeOptions { target_video_bitrate_bps: Some(maxrate_kbps * 1000), window, ..Default::default() });
    }
}
