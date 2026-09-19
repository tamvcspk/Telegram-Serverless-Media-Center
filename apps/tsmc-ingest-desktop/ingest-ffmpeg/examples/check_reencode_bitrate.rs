//! Verify `reencode_to_mp4()` PRODUCTION (không phải encoder trần như
//! `check_bitrate_control`) có áp `target_video_bitrate_bps` thật — Option C,
//! ADR-0017 § addendum 2026-09-19. Chạy: `cargo run --release --example
//! check_reencode_bitrate -p ingest-ffmpeg -- <input> <out_dir> <bps>`; in
//! dung lượng output khi `None` so với `Some(bps)`.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: check_reencode_bitrate <input> <out_dir> <target_bps>");
        std::process::exit(2);
    }
    let (input, out_dir, bps) = (&args[1], &args[2], args[3].parse::<u64>().expect("bps phải là số"));

    let default_out = format!("{out_dir}/default.mp4");
    let capped_out = format!("{out_dir}/capped.mp4");

    println!("chạy None...");
    ingest_ffmpeg::reencode_to_mp4(input, &default_out, None).expect("reencode None");
    println!("chạy Some({bps})...");
    ingest_ffmpeg::reencode_to_mp4(input, &capped_out, Some(bps)).expect("reencode Some");

    let default_size = std::fs::metadata(&default_out).expect("stat default").len();
    let capped_size = std::fs::metadata(&capped_out).expect("stat capped").len();
    println!("None       : {default_size} byte");
    println!("Some({bps}): {capped_size} byte");
    println!("capped/default = {:.2}", capped_size as f64 / default_size as f64);
}
