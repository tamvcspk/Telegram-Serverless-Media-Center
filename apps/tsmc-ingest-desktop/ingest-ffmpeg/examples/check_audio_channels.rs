//! Verify vá crash audio mono (docs/roadmap.md § Ingest, "BUG có sẵn:
//! `reencode_to_mp4()` segfault khi audio MONO", `src/audio_layout.rs`) — chạy
//! CẢ HAI đường có encode AAC: `remux(.., true)` (Hạng C) và
//! `reencode_to_mp4()` (Hạng D). Chạy: `cargo run --release --example
//! check_audio_channels -p ingest-ffmpeg -- <input> <out_dir>`; đối chiếu số
//! kênh output bằng `ffprobe` (mono → 1, stereo/5.1 → 2). Trước khi vá, input
//! audio mono sập ngay ở đây với `STATUS_ACCESS_VIOLATION`.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: check_audio_channels <input> <out_dir>");
        std::process::exit(2);
    }
    let (input, out_dir) = (&args[1], &args[2]);

    let remux_out = format!("{out_dir}/remux_aac.mp4");
    let reencode_out = format!("{out_dir}/reencode.mp4");
    let duration_sec = ingest_ffmpeg::probe(input).expect("probe").duration_sec;
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let on_progress = |p: ingest_ffmpeg::PipelineProgress| println!("  tick: {:.1}/{:.1}s, {} byte", p.elapsed_sec, p.duration_sec, p.bytes_written);

    println!("remux (Hạng C, audio -> AAC)...");
    ingest_ffmpeg::remux(input, &remux_out, true, duration_sec, &on_progress, &cancel).expect("remux");
    println!("reencode_to_mp4 (Hạng D)...");
    ingest_ffmpeg::reencode_to_mp4(input, &reencode_out, None, duration_sec, &on_progress, &cancel).expect("reencode");

    println!("remux    : {} byte", std::fs::metadata(&remux_out).expect("stat remux").len());
    println!("reencode : {} byte", std::fs::metadata(&reencode_out).expect("stat reencode").len());
}
