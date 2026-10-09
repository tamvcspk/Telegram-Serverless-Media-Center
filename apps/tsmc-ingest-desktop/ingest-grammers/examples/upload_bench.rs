//! Đo thông lượng upload MTProto của TSMC (grammers) — số đo của CHÍNH TSMC thay
//! cho số mượn từ tgmirror trong `docs/upload-mtproto.md` §3.
//!
//! **Chạy bằng tay, trong terminal của bạn** (CLAUDE.md: không chạy đăng nhập
//! MTProto hộ người dùng). Script tự đăng nhập bằng stdin (số điện thoại → mã →
//! 2FA nếu có) và lưu session RIÊNG `upload-bench.session.local` (không đụng
//! session của app). Session = toàn quyền tài khoản: đừng commit, đừng gửi đi
//! đâu; xoá file sau khi đo xong.
//!
//! Script CHỈ gọi `upload.saveBigFilePart` rồi bỏ — KHÔNG gọi lệnh đăng nào, nên
//! không có gì hiện ở bất kỳ chat nào; Telegram tự bỏ file chưa gắn vào tin nhắn
//! (`docs/upload-mtproto.md` §1.5). Mỗi ô đo chỉ đẩy `--mb` MB đầu của một file
//! thật trong `--dir` (không đẩy cả file nhiều GB), mỗi ô một file khác nhau để
//! cache đĩa không làm đẹp số.
//!
//! ```powershell
//! $env:TSMC_API_ID = "..."; $env:TSMC_API_HASH = "..."
//! cargo run --release -p ingest-grammers --example upload_bench -- --dir D:\co
//! # tuỳ chọn: --mb 512  --rounds 2  --cooldown 20  --cells static:3,shared:3,shared:4,shared:6,shared:8
//! # xoay kết nối: thêm @MB vào ô, vd shared:8@128 = đóng/mở lại 8 kết nối sau mỗi 128 MB
//! ```
//!
//! Kết quả: bảng ra màn hình + `upload-bench.local.json` (chỉ số liệu tổng hợp,
//! KHÔNG có tên file/đường dẫn/số điện thoại). `*.local.json` đã nằm trong
//! .gitignore.
//!
//! An toàn cho tài khoản thật:
//! - Quét TĂNG dần số kết nối (vòng lẻ) rồi GIẢM dần (vòng chẵn) để thấy hiệu
//!   ứng trôi theo thời gian; nghỉ `--cooldown` giây giữa các ô.
//! - Ô nào gặp 429 transport / timeout 30 s / lỗi lạ → đánh dấu "vỡ", nghỉ 90 s,
//!   và KHÔNG thử lại số kết nối đó hay cao hơn nữa.
//! - `FLOOD_WAIT` thật → dừng TOÀN BỘ ngay, in số giây phải chờ (không né,
//!   không đổi DC — ADR-0006).
//! - Một file một lúc, không chạy download song song (§3.3).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use grammers_client::{Client, SenderPool, SignInError};
use grammers_mtproto::transport;
use grammers_mtsender::{connect_with_auth, Sender};
use grammers_session::{storages::SqliteSession, Session as _};
use grammers_tl_types as tl;

type AnyResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const PART_SIZE: u64 = 512 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SERVER_ERROR_RETRIES: u32 = 5;
const BROKEN_COOLDOWN: Duration = Duration::from_secs(90);
const SAMPLE_EVERY: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, PartialEq)]
enum Sched {
    /// Hiện tại trong `multi_connection_upload`: worker i lấy part i, i+n, i+2n...
    Static,
    /// Iterator dùng chung: worker rảnh lấy part kế (docs/upload-mtproto.md §4.2).
    Shared,
}

#[derive(Clone, Copy)]
struct Cell {
    sched: Sched,
    conns: usize,
    /// 0 = không xoay; N > 0 = đóng/mở lại toàn bộ kết nối sau mỗi N MB (cú pháp `shared:8@128`).
    rotate_mb: u64,
}

impl Cell {
    fn label(&self) -> String {
        let base = format!("{}:{}", if self.sched == Sched::Static { "static" } else { "shared" }, self.conns);
        if self.rotate_mb > 0 { format!("{base}@{}", self.rotate_mb) } else { base }
    }
}

struct Args {
    dir: PathBuf,
    mb: u64,
    rounds: usize,
    cooldown: Duration,
    cells: Vec<Cell>,
    session: String,
    out: String,
}

fn parse_cells(s: &str) -> Vec<Cell> {
    s.split(',')
        .filter_map(|c| {
            let (kind, rest) = c.trim().split_once(':')?;
            let (n, rotate) = match rest.split_once('@') {
                Some((n, r)) => (n, r.parse::<u64>().ok().filter(|r| *r > 0)?),
                None => (rest, 0),
            };
            let sched = match kind {
                "static" => Sched::Static,
                "shared" => Sched::Shared,
                _ => return None,
            };
            Some(Cell { sched, conns: n.parse().ok().filter(|n| (1..=16).contains(n))?, rotate_mb: rotate })
        })
        .collect()
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args {
        dir: PathBuf::new(),
        mb: 512,
        rounds: 2,
        cooldown: Duration::from_secs(20),
        cells: parse_cells("static:3,shared:3,shared:4,shared:6,shared:8"),
        session: "upload-bench.session.local".into(),
        out: "upload-bench.local.json".into(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = || it.next().ok_or_else(|| format!("{flag} thiếu giá trị"));
        match flag.as_str() {
            "--dir" => a.dir = PathBuf::from(val()?),
            "--mb" => a.mb = val()?.parse().map_err(|_| "--mb phải là số")?,
            "--rounds" => a.rounds = val()?.parse().map_err(|_| "--rounds phải là số")?,
            "--cooldown" => a.cooldown = Duration::from_secs(val()?.parse().map_err(|_| "--cooldown phải là số giây")?),
            "--cells" => a.cells = parse_cells(&val()?),
            "--session" => a.session = val()?,
            "--out" => a.out = val()?,
            other => return Err(format!("cờ lạ: {other}")),
        }
    }
    if a.dir.as_os_str().is_empty() {
        return Err("thiếu --dir <thư mục chứa file video thật>".into());
    }
    if a.cells.is_empty() {
        return Err("--cells rỗng/sai định dạng, ví dụ static:3,shared:4".into());
    }
    if a.mb == 0 || a.mb > 1500 {
        return Err("--mb nên trong 1..1500 (trần file 2 GB cho tài khoản thường)".into());
    }
    Ok(a)
}

fn prompt(msg: &str) -> String {
    use std::io::Write;
    print!("{msg}");
    std::io::stdout().flush().ok();
    let mut s = String::new();
    std::io::stdin().read_line(&mut s).ok();
    s.trim().to_string()
}

/// Mọi file trong `dir` (đệ quy) đủ lớn để cắt `need` byte đầu.
fn collect_files(dir: &Path, need: u64) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(p),
                Ok(m) if m.is_file() && m.len() >= need => out.push(p),
                _ => {}
            }
        }
    }
    out.sort();
    out
}

#[derive(Debug)]
enum CellFail {
    /// FLOOD_WAIT thật — dừng cả phiên đo.
    FloodWait(u64),
    /// 429 transport / timeout / lỗi lạ — ô "vỡ", không leo thêm.
    Pushback(String),
}

struct CellResult {
    cell: Cell,
    round: usize,
    file_idx: usize,
    bytes: u64,
    connect_secs: f64,
    secs: f64,
    mbps: f64,
    windows_mbps: Vec<f64>,
    parts_per_worker: Vec<u64>,
    server_retries: u32,
    failure: Option<String>,
}

fn classify(err: &grammers_client::InvocationError) -> Option<CellFail> {
    if let Some(s) = ingest_grammers::flood_wait_seconds(err) {
        return Some(CellFail::FloodWait(s));
    }
    None
}

fn is_server_5xx(err: &grammers_client::InvocationError) -> bool {
    matches!(err, grammers_client::InvocationError::Rpc(rpc) if (500..600).contains(&rpc.code))
}

async fn open_senders(
    n: usize,
    address: SocketAddr,
    auth_key: [u8; 256],
    api_id: i32,
) -> AnyResult<Vec<Sender<transport::Full, grammers_mtproto::mtp::Encrypted>>> {
    let init = tl::functions::InvokeWithLayer {
        layer: tl::LAYER,
        query: tl::functions::InitConnection {
            api_id,
            device_model: "tsmc-upload-bench".to_string(),
            system_version: std::env::consts::OS.to_string(),
            app_version: "bench".to_string(),
            system_lang_code: "en".to_string(),
            lang_pack: String::new(),
            lang_code: "en".to_string(),
            proxy: None,
            params: None,
            query: tl::functions::help::GetConfig {},
        },
    };
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        let mut s = connect_with_auth(transport::Full::new(), grammers_mtsender::ServerAddr::Tcp { address }, auth_key).await?;
        s.invoke(&init).await?;
        v.push(s);
    }
    Ok(v)
}

#[allow(clippy::too_many_arguments)]
async fn run_cell(
    cell: Cell,
    round: usize,
    file_idx: usize,
    path: &Path,
    total: u64,
    address: SocketAddr,
    auth_key: [u8; 256],
    api_id: i32,
) -> Result<CellResult, CellFail> {
    let total_parts = total.div_ceil(PART_SIZE) as i32;
    // `rotate_mb > 0`: đóng hết kết nối và mở lại sau mỗi N MB (cùng file_id) để thử
    // xem kết nối mới có lại giai đoạn nhanh không. Phần mở lại tính vào `secs`.
    let epoch_parts: i32 = if cell.rotate_mb > 0 { ((cell.rotate_mb * 1_048_576) / PART_SIZE).max(1) as i32 } else { total_parts };

    let file_id: i64 = rand::random();
    let bytes_done = Arc::new(AtomicU64::new(0));
    let retries = Arc::new(AtomicU64::new(0));

    // Lấy mẫu thông lượng mỗi SAMPLE_EVERY để thấy hiện tượng "tụt theo thời gian" (§3.2).
    let windows = Arc::new(std::sync::Mutex::new(Vec::<f64>::new()));
    let sampler = {
        let (bytes_done, windows) = (bytes_done.clone(), windows.clone());
        tokio::spawn(async move {
            let mut last = 0u64;
            loop {
                tokio::time::sleep(SAMPLE_EVERY).await;
                let now = bytes_done.load(Ordering::Relaxed);
                windows.lock().unwrap().push((now - last) as f64 / SAMPLE_EVERY.as_secs_f64() / 1_048_576.0);
                last = now;
            }
        })
    };

    let n = cell.conns;
    let mut connect_secs = 0.0f64;
    let mut parts_per_worker = vec![0u64; n];
    let mut t0 = Instant::now();
    let mut epoch_start = 0i32;
    let mut first = true;
    let mut failure: Option<CellFail> = None;

    while epoch_start < total_parts {
        let epoch_end = (epoch_start + epoch_parts).min(total_parts);

        let t_conn = Instant::now();
        let mut senders = match open_senders(n, address, auth_key, api_id).await {
            Ok(s) => s,
            Err(e) => {
                failure = Some(CellFail::Pushback(format!("mở {n} kết nối thất bại: {e}")));
                break;
            }
        };
        connect_secs += t_conn.elapsed().as_secs_f64();
        if first {
            t0 = Instant::now(); // kết nối đầu tiên không tính vào thời gian truyền (khớp các lần đo trước)
            first = false;
        }

        let next_part = Arc::new(AtomicI32::new(epoch_start));
        let workers = senders.iter_mut().enumerate().map(|(idx, sender)| {
            let (bytes_done, next_part, retries) = (bytes_done.clone(), next_part.clone(), retries.clone());
            async move {
                use tokio::io::{AsyncReadExt, AsyncSeekExt};
                let mut file = tokio::fs::File::open(path).await.map_err(|e| CellFail::Pushback(format!("mở file: {e}")))?;
                let mut static_part = epoch_start + idx as i32;
                let mut done_parts = 0u64;
                loop {
                    let part = match cell.sched {
                        Sched::Shared => next_part.fetch_add(1, Ordering::SeqCst),
                        Sched::Static => {
                            let p = static_part;
                            static_part += n as i32;
                            p
                        }
                    };
                    if part >= epoch_end {
                        break;
                    }
                    let offset = part as u64 * PART_SIZE;
                    let len = PART_SIZE.min(total - offset) as usize;
                    let mut buf = vec![0u8; len];
                    file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| CellFail::Pushback(format!("seek: {e}")))?;
                    file.read_exact(&mut buf).await.map_err(|e| CellFail::Pushback(format!("đọc file: {e}")))?;

                    let mut attempt = 0u32;
                    loop {
                        let req = tl::functions::upload::SaveBigFilePart { file_id, file_part: part, file_total_parts: total_parts, bytes: buf.clone() };
                        match tokio::time::timeout(REQUEST_TIMEOUT, sender.invoke(&req)).await {
                            Err(_) => return Err(CellFail::Pushback(format!("timeout {}s ở part {part}", REQUEST_TIMEOUT.as_secs()))),
                            Ok(Ok(true)) => break,
                            Ok(Ok(false)) => return Err(CellFail::Pushback(format!("server trả false cho part {part}"))),
                            Ok(Err(e)) => {
                                if let Some(f) = classify(&e) {
                                    return Err(f);
                                }
                                if attempt < SERVER_ERROR_RETRIES && is_server_5xx(&e) {
                                    retries.fetch_add(1, Ordering::Relaxed);
                                    tokio::time::sleep(Duration::from_secs_f64((1u64 << attempt.min(5)) as f64 * (0.75 + rand::random::<f64>() * 0.5))).await;
                                    attempt += 1;
                                    continue;
                                }
                                // 429 transport hiện ra dưới dạng lỗi IO/"invalid buffer ... 429" — không retry tại chỗ (§4.2).
                                return Err(CellFail::Pushback(format!("part {part}: {e}")));
                            }
                        }
                    }
                    bytes_done.fetch_add(len as u64, Ordering::Relaxed);
                    done_parts += 1;
                }
                Ok::<u64, CellFail>(done_parts)
            }
        });
        match futures_util::future::try_join_all(workers).await {
            Ok(per_worker) => {
                for (acc, p) in parts_per_worker.iter_mut().zip(per_worker) {
                    *acc += p;
                }
            }
            Err(f) => {
                failure = Some(f);
                break;
            }
        }
        drop(senders);
        epoch_start = epoch_end;
    }

    sampler.abort();
    if let Some(f) = failure {
        return Err(f);
    }
    let secs = t0.elapsed().as_secs_f64();
    let bytes = bytes_done.load(Ordering::Relaxed);
    let windows_mbps = windows.lock().unwrap().clone();
    Ok(CellResult {
        cell,
        round,
        file_idx,
        bytes,
        connect_secs,
        secs,
        mbps: bytes as f64 / secs / 1_048_576.0,
        windows_mbps,
        parts_per_worker,
        server_retries: retries.load(Ordering::Relaxed) as u32,
        failure: None,
    })
}

fn json_f(v: f64) -> String {
    if v.is_finite() { format!("{v:.2}") } else { "null".into() }
}

fn to_json(args: &Args, results: &[CellResult], aborted: Option<&str>) -> String {
    let rows: Vec<String> = results
        .iter()
        .map(|r| {
            format!(
                "    {{\"cell\":\"{}\",\"round\":{},\"file_idx\":{},\"mb\":{:.0},\"connect_s\":{},\"secs\":{},\"mbps\":{},\"windows_mbps\":[{}],\"parts_per_worker\":[{}],\"server_retries\":{},\"failure\":{}}}",
                r.cell.label(),
                r.round,
                r.file_idx,
                r.bytes as f64 / 1_048_576.0,
                json_f(r.connect_secs),
                json_f(r.secs),
                json_f(r.mbps),
                r.windows_mbps.iter().map(|w| json_f(*w)).collect::<Vec<_>>().join(","),
                r.parts_per_worker.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(","),
                r.server_retries,
                r.failure.as_ref().map(|f| format!("\"{}\"", f.replace('"', "'").replace('\\', "/"))).unwrap_or("null".into()),
            )
        })
        .collect();
    format!(
        "{{\n  \"note\":\"upload-bench: chi so lieu tong hop, khong co ten file/duong dan/so dien thoai\",\n  \"mb_per_cell\":{},\n  \"rounds\":{},\n  \"cooldown_s\":{},\n  \"aborted\":{},\n  \"results\":[\n{}\n  ]\n}}\n",
        args.mb,
        args.rounds,
        args.cooldown.as_secs(),
        aborted.map(|a| format!("\"{a}\"")).unwrap_or("null".into()),
        rows.join(",\n")
    )
}

fn print_row(r: &CellResult) {
    let w: Vec<String> = r.windows_mbps.iter().map(|w| format!("{w:.1}")).collect();
    let parts: Vec<String> = r.parts_per_worker.iter().map(|p| p.to_string()).collect();
    println!(
        "  vòng {} {:<10} {:>6.1} MB/s  ({:>5.1}s, mở kết nối {:.1}s)  cửa sổ 10s: [{}]  part/worker: [{}]{}",
        r.round,
        r.cell.label(),
        r.mbps,
        r.secs,
        r.connect_secs,
        w.join(" "),
        parts.join(" "),
        if r.server_retries > 0 { format!("  retry5xx={}", r.server_retries) } else { String::new() }
    );
}

#[tokio::main]
async fn main() -> AnyResult<()> {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Lỗi tham số: {e}");
            std::process::exit(2);
        }
    };
    let api_id: i32 = std::env::var("TSMC_API_ID").map_err(|_| "đặt biến môi trường TSMC_API_ID")?.parse()?;
    let api_hash = std::env::var("TSMC_API_HASH").map_err(|_| "đặt biến môi trường TSMC_API_HASH")?;

    let total = args.mb * 1_048_576;
    let files = collect_files(&args.dir, total);
    if files.is_empty() {
        return Err(format!("không có file nào ≥ {} MB trong {}", args.mb, args.dir.display()).into());
    }
    // Mỗi ô một file khác nhau (xoay vòng) để cache đĩa không làm đẹp số.
    let cells_per_round = args.cells.len();
    let planned = cells_per_round * args.rounds;
    println!(
        "Tìm thấy {} file ≥ {} MB. Kế hoạch: {} ô × {} MB = {:.1} GB đẩy lên (Telegram sẽ tự bỏ, không đăng gì).",
        files.len(),
        args.mb,
        planned,
        args.mb,
        (planned as u64 * args.mb) as f64 / 1024.0
    );
    println!("Ô đo: {}.  Nghỉ {}s giữa các ô.", args.cells.iter().map(Cell::label).collect::<Vec<_>>().join(", "), args.cooldown.as_secs());
    let ans = prompt("Enter để bắt đầu (gõ n để huỷ): ");
    if ans.eq_ignore_ascii_case("n") {
        return Ok(());
    }

    let session = Arc::new(SqliteSession::open(&args.session).await?);
    let SenderPool { runner, handle, .. } = SenderPool::new(Arc::clone(&session), api_id);
    let client = Client::new(handle.clone());
    let pool_task = tokio::spawn(runner.run());

    if !client.is_authorized().await? {
        let phone = prompt("Số điện thoại (+84...): ");
        let token = client.request_login_code(&phone, &api_hash).await?;
        let code = prompt("Mã đăng nhập Telegram gửi: ");
        match client.sign_in(&token, &code).await {
            Ok(_) => {}
            Err(SignInError::PasswordRequired(t)) => {
                let pw = prompt(&format!("Mật khẩu 2FA (gợi ý: {}): ", t.hint().unwrap_or("không")));
                client.check_password(t, pw.as_bytes()).await?;
            }
            Err(e) => return Err(e.into()),
        }
    }
    // Một RPC thành công để SenderPool ghi auth_key của home DC vào session.
    client.get_me().await?;

    let home_dc = session.home_dc_id()?;
    let dc_option = session.dc_option(home_dc)?.ok_or("không có dc_option cho home DC")?;
    let auth_key = dc_option.auth_key.ok_or("chưa có auth_key trong session")?;
    let address: SocketAddr = dc_option.ipv4.into();
    println!("Đã đăng nhập. Home DC{home_dc}. Bắt đầu đo.\n");

    let mut results: Vec<CellResult> = Vec::new();
    let mut broken_at: Option<usize> = None;
    let mut aborted: Option<String> = None;
    let mut file_cursor = 0usize;

    'rounds: for round in 1..=args.rounds {
        let mut order: Vec<Cell> = args.cells.clone();
        order.sort_by_key(|c| c.conns); // ổn định: static đứng trước shared khi cùng số kết nối
        if round % 2 == 0 {
            order.reverse();
        }
        for cell in order {
            if broken_at.is_some_and(|b| cell.conns >= b) {
                println!("  vòng {round} {:<10} bỏ qua (≥ mức đã vỡ)", cell.label());
                continue;
            }
            let file_idx = file_cursor % files.len();
            file_cursor += 1;
            let res = tokio::select! {
                r = run_cell(cell, round, file_idx, &files[file_idx], total, address, auth_key, api_id) => r,
                _ = tokio::signal::ctrl_c() => { aborted = Some("người dùng Ctrl+C".into()); break 'rounds; }
            };
            match res {
                Ok(r) => {
                    print_row(&r);
                    results.push(r);
                }
                Err(CellFail::FloodWait(s)) => {
                    println!("  !! FLOOD_WAIT {s}s ở {} — DỪNG TOÀN BỘ, hãy chờ đủ {s}s rồi mới chạy lại.", cell.label());
                    aborted = Some(format!("FLOOD_WAIT {s}s ở {}", cell.label()));
                    break 'rounds;
                }
                Err(CellFail::Pushback(why)) => {
                    println!("  !! {} VỠ: {why} — nghỉ {}s, không thử mức này/cao hơn nữa.", cell.label(), BROKEN_COOLDOWN.as_secs());
                    results.push(CellResult {
                        cell, round, file_idx, bytes: 0, connect_secs: 0.0, secs: 0.0, mbps: 0.0,
                        windows_mbps: vec![], parts_per_worker: vec![], server_retries: 0, failure: Some(why),
                    });
                    broken_at = Some(broken_at.map_or(cell.conns, |b| b.min(cell.conns)));
                    tokio::time::sleep(BROKEN_COOLDOWN).await;
                    continue;
                }
            }
            tokio::time::sleep(args.cooldown).await;
        }
    }

    println!("\n=== Tóm tắt (MB/s trung bình theo ô, qua các vòng) ===");
    let mut seen: Vec<Cell> = Vec::new();
    for c in &args.cells {
        if !seen.iter().any(|s| s.sched == c.sched && s.conns == c.conns && s.rotate_mb == c.rotate_mb) {
            seen.push(*c);
        }
    }
    for c in seen {
        let ok: Vec<f64> = results.iter().filter(|r| r.cell.sched == c.sched && r.cell.conns == c.conns && r.cell.rotate_mb == c.rotate_mb && r.failure.is_none()).map(|r| r.mbps).collect();
        let broken = results.iter().filter(|r| r.cell.sched == c.sched && r.cell.conns == c.conns && r.cell.rotate_mb == c.rotate_mb && r.failure.is_some()).count();
        if ok.is_empty() {
            println!("  {:<10} {}", c.label(), if broken > 0 { "VỠ" } else { "chưa đo" });
        } else {
            let avg = ok.iter().sum::<f64>() / ok.len() as f64;
            println!("  {:<10} {:>6.1} MB/s  (min {:.1}, max {:.1}, {} lần{})", c.label(), avg, ok.iter().cloned().fold(f64::MAX, f64::min), ok.iter().cloned().fold(0.0, f64::max), ok.len(), if broken > 0 { ", có lần vỡ" } else { "" });
        }
    }

    std::fs::write(&args.out, to_json(&args, &results, aborted.as_deref()))?;
    println!("\nĐã ghi {} (chỉ số liệu tổng hợp). Xoá {} khi xong.", args.out, args.session);

    handle.quit();
    let _ = pool_task.await;
    Ok(())
}
