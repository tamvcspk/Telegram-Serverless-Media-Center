//! CLI đo SPIKE-10 nhánh R3 (grammers) — xem docs/spikes/README.md#spike-10.
//! Người dùng tự chạy trong terminal của họ (đăng nhập MTProto thật) — Claude
//! không chạy hộ (CLAUDE.md). Credential đọc từ `tools/.env` (khuôn SPIKE-07)
//! hoặc biến môi trường `TSMC_API_ID`/`TSMC_API_HASH`.

mod rpc;
mod session;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use clap::{Parser, Subcommand};
use ingest_rpc_trait::{CancelFlag, IngestRpc, IngestRpcError, VideoUploadInput};

#[derive(Parser)]
#[command(name = "r3-grammers", about = "SPIKE-10 R3 — IngestRpc bằng grammers")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// File session SQLite — mặc định nằm ngoài repo (cạnh binary, gitignore
    /// qua *.session*). `global = true` để chấp nhận cả trước lẫn sau tên
    /// subcommand (vd `r3-grammers login --session x` VÀ `r3-grammers
    /// --session x login`) — không có cờ này, clap chỉ nhận đứng trước
    /// subcommand, khác trực giác thường dùng (phát hiện thật khi tự chạy).
    #[arg(long, global = true, default_value = "r3-grammers.session")]
    session: String,
}

#[derive(Subcommand)]
enum Command {
    /// Đăng nhập một lần (phone + OTP + 2FA nếu có). Chạy lại sau đó không
    /// hỏi lại OTP — đúng tiêu chí M1.
    Login,
    /// M2-M5: upload một file video thật lên kênh test, in tiến trình + RAM.
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
        /// M5: tự động huỷ sau N giây — cách đo lặp lại được thay vì canh
        /// tay Ctrl+C đúng thời điểm. Không truyền thì Ctrl+C vẫn huỷ được
        /// bình thường (interactive), chỉ không có mốc thời gian cố định.
        #[arg(long)]
        cancel_after_secs: Option<u64>,
    },
    /// M8: đọc document đang ghim trên kênh (nếu có) — in msgId + nội dung.
    ReadCatalog {
        #[arg(long)]
        channel: String,
    },
    /// M8: publish + pin + (tuỳ chọn) xoá bản cũ — cùng khuôn `sendFile →
    /// pinMessage → deleteMessages` của SPIKE-06. Chạy `read-catalog` trước
    /// và sau để tự xác nhận đọc lại byte-chính-xác.
    PublishCatalog {
        #[arg(long)]
        channel: String,
        /// File JSON cục bộ sẽ publish nguyên văn (không parse/validate).
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        previous_msg_id: Option<i64>,
    },
}

fn load_env() {
    // Cùng quy ước `loadSharedEnv()` của tools/spike-07/login.mjs — đọc
    // tools/.env, không ghi đè biến đã có sẵn. CARGO_MANIFEST_DIR ở đây là
    // tools/spike-10/r3-grammers — SÂU HƠN MỘT CẤP so với tools/spike-07/
    // (nơi quy ước "một cấp trên" gốc được viết), nên cần "../../.env"
    // chứ không phải "../.env" — bug thật đã gặp khi tự chạy: panic
    // "thiếu TSMC_API_ID" dù tools/.env tồn tại và có giá trị đúng, vì
    // đường dẫn cũ trỏ nhầm vào tools/spike-10/.env (không tồn tại).
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
                // SAFETY: chạy đơn luồng ở thời điểm khởi động, trước khi
                // spawn bất kỳ task nào đọc biến môi trường.
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

    let connected = session::connect(&cli.session, api_id).await?;
    session::ensure_logged_in(&connected.client, &api_hash).await?;

    match cli.command {
        Command::Login => {
            println!("Đăng nhập xong, session lưu tại {}", cli.session);
        }
        Command::Upload { channel, file, width, height, duration_sec, cancel_after_secs } => {
            let rpc = rpc::GrammersIngestRpc::new(connected.client.clone(), connected.session.clone(), api_id);
            let resolved = rpc.resolve_channel(&channel).await?;
            println!("Resolved: {} (\"{}\"), is_own={}", resolved.id, resolved.title, resolved.is_own);
            if !rpc.check_write_permission(&resolved).await? {
                eprintln!("CẢNH BÁO: tài khoản không phải chủ kênh này (is_own=false) — upload có thể bị Telegram từ chối.");
            }

            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or("video.mp4").to_string();
            let cancel = CancelFlag::new();

            // M5: huỷ qua Ctrl+C (interactive) HOẶC tự động sau
            // --cancel-after-secs (đo lặp lại được) — chạy song song với
            // upload, không chặn nó. Task tự thoát khi upload xong (bị
            // .abort() ngay sau `rpc.upload_video()` return).
            let cancel_trigger = cancel.clone();
            let watcher = tokio::spawn(async move {
                match cancel_after_secs {
                    Some(secs) => {
                        tokio::select! {
                            _ = tokio::time::sleep(std::time::Duration::from_secs(secs)) => {
                                println!("\n[test] tự động huỷ sau {secs}s (--cancel-after-secs)");
                            }
                            _ = tokio::signal::ctrl_c() => {
                                println!("\n[huỷ] Ctrl+C nhận được, đang dừng...");
                            }
                        }
                    }
                    None => {
                        let _ = tokio::signal::ctrl_c().await;
                        println!("\n[huỷ] Ctrl+C nhận được, đang dừng...");
                    }
                }
                cancel_trigger.cancel();
            });

            let progress_cb = move |p: ingest_rpc_trait::UploadProgress| {
                let pct = if p.total_bytes > 0 { (p.bytes_sent as f64 / p.total_bytes as f64) * 100.0 } else { 0.0 };
                print!("\rupload: {:.1}% ({} / {} byte)   ", pct, p.bytes_sent, p.total_bytes);
                use std::io::Write as _;
                std::io::stdout().flush().ok();
            };

            let t0 = Instant::now();
            let result = rpc
                .upload_video(&resolved, VideoUploadInput { file_path: file, file_name: file_name.clone(), mime_type: None, width, height, duration_sec, thumbnail_path: None, caption: None }, &progress_cb, &cancel)
                .await;
            watcher.abort();

            match result {
                Ok(r) => println!("\nUpload xong sau {:.1}s — msgId {}", t0.elapsed().as_secs_f64(), r.msg_id),
                Err(IngestRpcError::Cancelled) => println!("\n[M5] Đã huỷ sau {:.1}s kể từ lúc bắt đầu — traffic dừng, không có msgId.", t0.elapsed().as_secs_f64()),
                Err(e) => return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
            }
        }
        Command::ReadCatalog { channel } => {
            let rpc = rpc::GrammersIngestRpc::new(connected.client.clone(), connected.session.clone(), api_id);
            let resolved = rpc.resolve_channel(&channel).await?;
            match rpc.read_pinned_catalog(&resolved).await? {
                Some(catalog) => println!("Pinned msgId {} (publisher {}):\n{}", catalog.msg_id, catalog.publisher_id, catalog.raw),
                None => println!("Không có catalog nào đang ghim trên kênh này."),
            }
        }
        Command::PublishCatalog { channel, file, previous_msg_id } => {
            let rpc = rpc::GrammersIngestRpc::new(connected.client.clone(), connected.session.clone(), api_id);
            let resolved = rpc.resolve_channel(&channel).await?;
            let bytes = std::fs::read(&file)?;
            let result = rpc.publish_catalog(&resolved, &bytes, previous_msg_id).await?;
            println!("Publish xong — msgId {} ({} byte). Chạy `read-catalog` để xác nhận đọc lại byte-chính-xác.", result.msg_id, bytes.len());
        }
    }

    connected.pool_task.abort();
    Ok(())
}

// Giữ Arc ở scope crate cho các phần mở rộng sau (đo RAM bằng tiến trình
// riêng qua Get-Process theo kế hoạch, không đo tự thân ở đây).
#[allow(dead_code)]
fn _unused(_a: Arc<()>) {}
