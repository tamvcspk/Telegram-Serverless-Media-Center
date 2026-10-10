//! Verify re-encode THẬT bằng `libx264` qua `reencode_with_options()` (ADR-0023 § 4c.1/4c.2): CRF +
//! trần VBV, ABR 1-pass và ABR 2-pass để so. In dung lượng, bitrate, thời gian, tốc độ x-realtime và
//! (2-pass) thời điểm pass 1 kết thúc — số cho `FIRST_PASS_PROGRESS_SHARE` và độ chính xác ±2%.
//!
//! Chạy: `cargo run --release --example check_x264_crf -p ingest-ffmpeg -- <input> <out_dir> [rf] [maxrate_kbps] [start_sec len_sec] [crf|abr|abr2pass]`
//! (cần FFMPEG_DIR trỏ tới FFmpeg có x264 và thư mục `bin` của nó trong PATH.)
//! `maxrate_kbps` > 0 chạy thêm ABR 1-pass và 2-pass với bitrate VIDEO đích = `maxrate_kbps`.
//! Bỏ trống `start_sec len_sec` (hoặc `len_sec` = 0) = encode cả file; cuối cùng là tên một lượt để chạy riêng.

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
        (Some(s), Some(l)) => Some((s.parse::<f64>().expect("start"), l.parse::<f64>().expect("len"))).filter(|(_, len)| *len > 0.0),
        _ => None,
    };
    let only = args.get(7).map(String::as_str);

    let probe = ingest_ffmpeg::probe(input).expect("probe");
    let media_sec = window.map_or(probe.duration_sec, |(_, l)| l);
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let bufsize_bits = maxrate_kbps * 1000 * 2;

    let run = |label: &str, options: ingest_ffmpeg::ReencodeOptions| {
        if only.is_some_and(|o| o != label) {
            return;
        }
        let out = format!("{out_dir}/{label}.mp4");
        let began = Instant::now();
        // Pass 1 báo bytes_written = 0 (không có file ra); lần đầu > 0 = pass 2 bắt đầu ghi.
        let pass2_at: std::sync::Mutex<Option<f64>> = std::sync::Mutex::new(None);
        let on_progress = |p: ingest_ffmpeg::PipelineProgress| {
            if p.bytes_written > 0 {
                let mut slot = pass2_at.lock().unwrap();
                if slot.is_none() {
                    *slot = Some(began.elapsed().as_secs_f64());
                }
            }
        };
        ingest_ffmpeg::reencode_with_options(input, &out, &options, probe.duration_sec, &on_progress, &cancel).unwrap_or_else(|e| panic!("{label}: {e}"));
        let wall = began.elapsed().as_secs_f64();
        let pass2_note = pass2_at.lock().unwrap().map_or(String::new(), |t| format!(" · pass 1 ≈ {:.0}% thời gian", t / wall * 100.0));
        let bytes = std::fs::metadata(&out).expect("stat").len();
        let out_probe = ingest_ffmpeg::probe(&out).expect("probe out");
        let v = out_probe.video.expect("video out");
        println!(
            "{label:>10}: {:>10} byte · {:>6.0} kbps tổng · {}x{} {} · {wall:>6.1}s · {:.2}x thời gian thực{pass2_note}",
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
        run("abr2pass", ingest_ffmpeg::ReencodeOptions { target_video_bitrate_bps: Some(maxrate_kbps * 1000), two_pass: true, window, ..Default::default() });
    }
}
