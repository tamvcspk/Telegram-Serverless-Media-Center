//! CLI đo SPIKE-10 nhánh R4 (ferogram) — xem docs/spikes/README.md#spike-10.
//! Đối xứng CLI với r3-grammers (cùng flag, cùng flow) để Đ3 so sánh công
//! bằng. Người dùng tự chạy trong terminal của họ — Claude không chạy hộ
//! đăng nhập MTProto (CLAUDE.md).

mod rpc;
mod session;

use std::path::PathBuf;
use std::time::Instant;

use clap::{Parser, Subcommand};
use ingest_rpc_trait::{CancelFlag, IngestRpc, VideoUploadInput};

#[derive(Parser)]
#[command(name = "r4-ferogram", about = "SPIKE-10 R4 — IngestRpc bằng ferogram")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Xem chú thích tương ứng ở r3-grammers/src/main.rs — `global = true`
    /// để nhận cả trước lẫn sau tên subcommand.
    #[arg(long, global = true, default_value = "r4-ferogram.session")]
    session: String,
}

#[derive(Subcommand)]
enum Command {
    Login,
    Upload {
        #[arg(long)]
        channel: String,
        #[arg(long)]
        file: PathBuf,
        #[arg(long, default_value_t = 1280)]
        width: u32,
        #[arg(long, default_value_t = 720)]
        height: u32,
        #[arg(long, default_value_t = 60)]
        duration_sec: u32,
    },
}

fn load_env() {
    // Xem chú thích đầy đủ ở r3-grammers/src/main.rs::load_env() — cùng bug
    // (đường dẫn thiếu một cấp "..") và cùng cách sửa.
    let candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.env");
    let Ok(content) = std::fs::read_to_string(&candidate) else { return };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if std::env::var(key).is_err() {
                unsafe { std::env::set_var(key, value.trim()) };
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    load_env();
    let cli = Cli::parse();

    let api_id: i32 = std::env::var("TSMC_API_ID").expect("thiếu TSMC_API_ID (tools/.env hoặc biến môi trường)").parse().expect("TSMC_API_ID phải là số");
    let api_hash = std::env::var("TSMC_API_HASH").expect("thiếu TSMC_API_HASH");

    let (client, _shutdown) = session::connect(&cli.session, api_id, &api_hash).await?;
    session::ensure_logged_in(&client).await?;

    match cli.command {
        Command::Login => {
            println!("Đăng nhập xong, session lưu tại {}", cli.session);
        }
        Command::Upload { channel, file, width, height, duration_sec } => {
            let rpc = rpc::FerogramIngestRpc::new(client.clone());
            let resolved = rpc.resolve_channel(&channel).await?;
            println!("Resolved: {} (\"{}\"), is_own={}", resolved.id, resolved.title, resolved.is_own);
            if !rpc.check_write_permission(&resolved).await? {
                eprintln!("CẢNH BÁO: tài khoản không phải chủ kênh này (is_own=false) — upload có thể bị Telegram từ chối.");
            }

            let cancel = CancelFlag::new();
            let progress_cb = move |p: ingest_rpc_trait::UploadProgress| {
                let pct = if p.total_bytes > 0 { (p.bytes_sent as f64 / p.total_bytes as f64) * 100.0 } else { 0.0 };
                print!("\rupload: {:.1}% ({} / {} byte)   ", pct, p.bytes_sent, p.total_bytes);
                use std::io::Write as _;
                std::io::stdout().flush().ok();
            };

            let t0 = Instant::now();
            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or("video.mp4").to_string();
            let result = rpc
                .upload_video(&resolved, VideoUploadInput { file_path: file, file_name, mime_type: None, width, height, duration_sec, thumbnail_path: None, caption: None }, &progress_cb, &cancel)
                .await?;
            println!("\nUpload xong sau {:.1}s — msgId {}", t0.elapsed().as_secs_f64(), result.msg_id);
        }
    }

    Ok(())
}
