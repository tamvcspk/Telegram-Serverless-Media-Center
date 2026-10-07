//! Verify `analyze_cut_signals()` (Giai đoạn 4b). Chạy:
//! `cargo run --release --example check_signals -p ingest-ffmpeg -- <input.mp4> <time_sec>...`
//! In số đo thô quanh từng thời điểm; đối chiếu với nội dung đã biết (chuyển
//! cảnh cứng + đoạn im lặng) — keyframe thật nên truyền thời điểm keyframe.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: check_signals <input> <time_sec>...");
        std::process::exit(2);
    }
    let times: Vec<f64> = args[2..].iter().map(|a| a.parse().expect("time")).collect();
    let started = std::time::Instant::now();
    let signals = ingest_ffmpeg::analyze_cut_signals(&args[1], &times, &ingest_ffmpeg::CancelFlag::new()).expect("analyze");
    for s in &signals {
        println!("t={:7.3}s  scene_diff={:?}  audio_rms_db={:?}", s.time_sec, s.scene_diff.map(|d| (d * 1000.0).round() / 1000.0), s.audio_rms_db.map(|d| (d * 10.0).round() / 10.0));
    }
    println!("{} ứng viên trong {:.2}s", signals.len(), started.elapsed().as_secs_f64());
}
