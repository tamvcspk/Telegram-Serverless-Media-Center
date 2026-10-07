//! `extract_thumbnail()` ghi được ảnh JPEG hợp lệ và KHÔNG còn cảnh báo `image2`. Chạy:
//! `cargo run --release --example check_thumbnail -p ingest-ffmpeg -- <input> <out.jpg> <seek_sec>`
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: check_thumbnail <input> <out.jpg> <seek_sec>");
        std::process::exit(2);
    }
    ingest_ffmpeg::extract_thumbnail(&args[1], &args[2], args[3].parse().expect("seek"), Some(320)).expect("thumbnail");
    println!("{} byte", std::fs::metadata(&args[2]).expect("stat").len());
}
