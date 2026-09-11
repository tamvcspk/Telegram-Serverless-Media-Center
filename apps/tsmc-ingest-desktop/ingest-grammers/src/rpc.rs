//! Implement `IngestRpc` (ingest-rpc-trait) bằng grammers-client 0.10.0.
//!
//! Ported nguyên vẹn từ `tools/spike-10/r3-grammers/src/rpc.rs` sau khi
//! SPIKE-10 đóng và ADR-0017 chọn `grammers-client` — xem
//! `docs/spikes/README.md#spike-10` cho toàn bộ số liệu/phát hiện thật đã
//! chứng minh code này chạy đúng trên tài khoản Telegram thật, và
//! `docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md` cho quyết định +
//! bốn điều kiện bắt buộc. Các phát hiện đã ghi lại lúc viết bản gốc (không
//! phải giả định trước khi code):
//! - `Client::upload_stream`/`upload_file` (client/files.rs) KHÔNG có tham
//!   số progress/cancel nào. `multi_connection_upload()` dưới đây tự quản
//!   progress/cancel trực tiếp thay vì bọc `AsyncRead`, xem điều tra M4 ở
//!   SPIKE-10.
//! - Không có `forceDocument` — `InputMessage::document(...)` đã tương
//!   đương ngữ nghĩa "gửi như file" của GramJS, không cần cờ riêng.
//! - `resolve_username` trả `Peer` (enum User/Group/Channel) — CACHE
//!   nguyên object này (như `channelCache` của gateway-index.ts), field
//!   `access_hash` của `ResolvedChannel` bỏ trống cho nhánh này (grammers
//!   tự quản access_hash nội bộ qua `PeerRef`, không cần lộ ra ngoài).
//! - **Điều tra M4 (SPIKE-10, 2026-09-06):** `SenderPool` cache ĐÚNG MỘT
//!   connection vật lý/dc_id vĩnh viễn — `upload_stream()`'s 4 "worker" chỉ
//!   là 4 request multiplex trên MỘT TCP connection, không phải song song
//!   thật. Nhưng `grammers-mtsender` lộ CÔNG KHAI đủ mảnh ghép để tự mở
//!   THÊM connection RAW, tái dùng auth_key đã có (`connect_with_auth`,
//!   `Sender::invoke`, `Session::dc_option()`/`home_dc_id()` — tất cả pub)
//!   — ĐÚNG cách `SenderPool` tự làm nội bộ khi kết nối lần đầu, không phải
//!   hack. `upload_video()` bên dưới tự mở N connection song song thật,
//!   round-robin part theo connection — kết quả thật (13.5%→24.4% baseline
//!   Telegram Desktop) ghi ở `docs/spikes/README.md#spike-10`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use grammers_client::{Client, InvocationError};
use grammers_client::message::InputMessage;
use grammers_client::media::{Attribute, Uploaded};
use grammers_client::peer::Peer;
use grammers_mtproto::transport;
use grammers_mtsender::{Sender, connect_with_auth};
use grammers_session::Session as _;
use grammers_session::storages::SqliteSession;
use grammers_tl_types as tl;
use ingest_rpc_trait::{
    CancelFlag, IngestRpc, IngestRpcError, PinnedCatalog, ProgressSink, ResolvedChannel, SubtitleUploadInput,
    UploadProgress, UploadedRef, VideoUploadInput,
};

/// Dịch một số mã lỗi RPC Telegram hay gặp thành thông báo tiếng Việt đọc
/// được — mặc định (`err.to_string()`) chỉ ra dạng kỹ thuật thô kiểu
/// `"request error: rpc error 403: USER_RESTRICTED caused by
/// channels.createChannel"`, không nói được gì cho user không đọc code.
/// **Đây là hạn chế THẬT từ phía Telegram, không phải lỗi của app** — không
/// có cách né hợp lệ (CLAUDE.md: tôn trọng giới hạn tài khoản thật).
fn to_rpc_error(err: InvocationError) -> IngestRpcError {
    if let Some(seconds) = crate::session::flood_wait_seconds(&err) {
        return IngestRpcError::FloodWait { seconds };
    }
    if let InvocationError::Rpc(rpc) = &err {
        if rpc.name == "USER_RESTRICTED" {
            return IngestRpcError::Other(
                "Telegram từ chối thao tác này cho tài khoản đang đăng nhập (USER_RESTRICTED) — thường do tài khoản còn mới/chưa đủ độ tin cậy, hoặc từng bị đánh dấu nghi ngờ spam. Không phải lỗi của app này và không có cách né hợp lệ — thử lại sau một thời gian, hoặc liên hệ hỗ trợ Telegram nếu nghi ngờ bị gắn nhầm."
                    .to_string(),
            );
        }
    }
    IngestRpcError::Other(err.to_string())
}

/// Kênh broadcast (`Peer::Channel`) HOẶC supergroup (`Peer::Group` mà
/// `raw` là `tl::enums::Chat::Channel` — grammers tự phân loại một
/// megagroup vào `Group` dù ở tầng TL nó vẫn là kiểu `Channel` với
/// `broadcast: false`) đều dùng chung họ RPC `channels.*`
/// (`InputPeer::Channel`) — tương thích với `read_pinned_catalog()`/
/// `upload_video()`/`publish_catalog()`/... hiện có (tất cả đều hardcode
/// match `InputPeer::Channel`). Group NHỎ chưa nâng cấp supergroup
/// (`tl::enums::Chat::Chat`) dùng hẳn một họ RPC khác (`messages.*`,
/// `InputPeer::Chat`) — KHÔNG tương thích, phải loại ngay từ bước liệt kê/
/// resolve, không để lọt vào rồi vỡ muộn (lỗi khó hiểu "peer không phải
/// InputPeer::Channel") ở bước upload/publish sau này. Trả `None` nếu peer
/// không thuộc loại nào dùng được (`User`, group nhỏ, chat không truy cập
/// được); `Some(creator)` nếu dùng được, kèm cờ có phải chính chủ hay không.
fn channel_like_creator(peer: &Peer) -> Option<bool> {
    match peer {
        Peer::Channel(chan) => Some(chan.raw.creator),
        Peer::Group(group) => match &group.raw {
            tl::enums::Chat::Channel(c) => Some(c.creator),
            _ => None,
        },
        Peer::User(_) => None,
    }
}

pub struct GrammersIngestRpc {
    client: Client,
    /// Cache `Peer` theo id chuỗi — cùng vai trò `channelCache` ở
    /// gateway-index.ts (TypeScript), vì `resolve_username` không tự cache.
    cache: Mutex<HashMap<String, Peer>>,
    /// Session dùng chung với `SenderPool` — cần đọc lại `dc_option()` (địa
    /// chỉ DC + auth_key đã có) để tự mở thêm connection RAW song song cho
    /// `upload_video()`, xem module doc comment.
    session: Arc<SqliteSession>,
    api_id: i32,
}

impl GrammersIngestRpc {
    pub fn new(client: Client, session: Arc<SqliteSession>, api_id: i32) -> Self {
        Self { client, cache: Mutex::new(HashMap::new()), session, api_id }
    }

    fn peer_for(&self, channel: &ResolvedChannel) -> Result<Peer, IngestRpcError> {
        self.cache
            .lock()
            .unwrap()
            .get(&channel.id)
            .cloned()
            .ok_or_else(|| IngestRpcError::Other(format!("channel {} không có trong cache — gọi resolve_channel() trước", channel.id)))
    }
}

#[async_trait]
impl IngestRpc for GrammersIngestRpc {
    async fn resolve_channel(&self, channel_ref: &str) -> Result<ResolvedChannel, IngestRpcError> {
        let peer = self.client.resolve_username(channel_ref.trim_start_matches('@')).await.map_err(to_rpc_error)?;
        let peer = peer.ok_or_else(|| IngestRpcError::Other(format!("\"{channel_ref}\" không resolve được thành peer nào")))?;
        let Some(creator) = channel_like_creator(&peer) else {
            return Err(IngestRpcError::Other(format!(
                "\"{channel_ref}\" không phải channel/broadcast hay supergroup — group nhỏ chưa nâng cấp supergroup không được hỗ trợ"
            )));
        };
        let id = format!("{:?}", peer.id());
        let title = peer.name().unwrap_or("(không có tên)").to_string();
        let resolved = ResolvedChannel { id: id.clone(), access_hash: String::new(), title, is_own: creator };
        self.cache.lock().unwrap().insert(id, peer);
        Ok(resolved)
    }

    async fn list_own_channels(&self) -> Result<Vec<ResolvedChannel>, IngestRpcError> {
        let mut iter = self.client.iter_dialogs();
        let mut result = Vec::new();
        while let Some(dialog) = iter.next().await.map_err(to_rpc_error)? {
            let peer = dialog.peer().clone();
            let Some(true) = channel_like_creator(&peer) else { continue };
            let id = format!("{:?}", peer.id());
            let title = peer.name().unwrap_or("(không có tên)").to_string();
            let resolved = ResolvedChannel { id: id.clone(), access_hash: String::new(), title, is_own: true };
            self.cache.lock().unwrap().insert(id, peer);
            result.push(resolved);
        }
        Ok(result)
    }

    async fn create_channel(&self, title: &str) -> Result<ResolvedChannel, IngestRpcError> {
        let updates = self
            .client
            .invoke(&tl::functions::channels::CreateChannel {
                broadcast: true,
                megagroup: false,
                for_import: false,
                forum: false,
                title: title.to_string(),
                about: String::new(),
                geo_point: None,
                address: None,
                ttl_period: None,
            })
            .await
            .map_err(to_rpc_error)?;

        // `channels.createChannel` trả `Updates` — chats mới tạo nằm trong
        // biến thể `Updates`/`Combined` (cả hai đều có field `chats`), khác
        // các biến thể "short" (không có channel nào cả, không áp dụng ở
        // đây). Cùng cách gateway-sync.ts (TS) đọc `Updates.chats` cho
        // `createStateChannel()`.
        let chats = match updates {
            tl::enums::Updates::Updates(u) => u.chats,
            tl::enums::Updates::Combined(u) => u.chats,
            _ => return Err(IngestRpcError::Other("channels.createChannel không trả Updates chứa danh sách chats".into())),
        };
        let chat = chats.into_iter().next().ok_or_else(|| IngestRpcError::Other("channels.createChannel không trả channel nào".into()))?;

        let peer = Peer::from_raw(&self.client, chat);
        let Peer::Channel(ref chan) = peer else {
            return Err(IngestRpcError::Other("channels.createChannel trả một peer không phải channel/broadcast".into()));
        };
        let id = format!("{:?}", chan.id());
        let resolved = ResolvedChannel { id: id.clone(), access_hash: String::new(), title: chan.title().to_string(), is_own: chan.raw.creator };
        self.cache.lock().unwrap().insert(id, peer);
        Ok(resolved)
    }

    async fn check_write_permission(&self, channel: &ResolvedChannel) -> Result<bool, IngestRpcError> {
        // Xem doc comment ResolvedChannel::is_own ở ingest-rpc-trait — đủ
        // cho phạm vi hiện tại, không cần RPC GetParticipant riêng.
        Ok(channel.is_own)
    }

    async fn read_pinned_catalog(&self, channel: &ResolvedChannel) -> Result<Option<PinnedCatalog>, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
        let Some(peer_ref) = peer_ref else {
            return Err(IngestRpcError::Other("không lấy được PeerRef cho channel".into()));
        };
        let input_peer: tl::enums::InputPeer = peer_ref.into();
        let full = self
            .client
            .invoke(&tl::functions::channels::GetFullChannel {
                channel: match &input_peer {
                    tl::enums::InputPeer::Channel(c) => tl::enums::InputChannel::Channel(tl::types::InputChannel { channel_id: c.channel_id, access_hash: c.access_hash }),
                    _ => return Err(IngestRpcError::Other("peer không phải InputPeer::Channel".into())),
                },
            })
            .await
            .map_err(to_rpc_error)?;

        let tl::enums::messages::ChatFull::Full(full) = full;
        // `tl::enums::ChatFull` của grammers-tl-types có HAI biến thể —
        // `Full` (basic group) và `ChannelFull` (channel/broadcast, đúng
        // trường hợp ở đây). Đã xác nhận thật trên kênh broadcast thật ở
        // SPIKE-10 (2026-09-05) — pattern SAI (khớp `Full`) từng làm hàm
        // này ÂM THẦM trả `Ok(None)` sai cho kênh channel/broadcast, không
        // panic, nguy hiểm hơn vì không ai biết đang đọc nhầm cho tới khi
        // catalog "biến mất" vô cớ.
        let tl::enums::ChatFull::ChannelFull(chat_full) = full.full_chat else {
            return Ok(None);
        };
        let Some(pinned_id) = chat_full.pinned_msg_id else {
            return Ok(None);
        };

        let messages = self.client.get_messages_by_id(peer_ref, &[pinned_id]).await.map_err(to_rpc_error)?;
        let Some(Some(message)) = messages.into_iter().next() else {
            return Ok(None);
        };
        let Some(media) = message.media() else {
            return Ok(None);
        };
        let buf = download_to_vec(&self.client, &media).await.map_err(to_rpc_error)?;
        Ok(Some(PinnedCatalog { msg_id: message.id() as i64, publisher_id: format!("{:?}", message.sender_id()), raw: String::from_utf8_lossy(&buf).into_owned() }))
    }

    async fn download_document(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<Vec<u8>, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;
        let messages = self.client.get_messages_by_id(peer_ref, &[msg_id as i32]).await.map_err(to_rpc_error)?;
        let Some(Some(message)) = messages.into_iter().next() else {
            return Err(IngestRpcError::Other(format!("message {msg_id} không tồn tại")));
        };
        let media = message.media().ok_or_else(|| IngestRpcError::Other(format!("message {msg_id} không có media")))?;
        let buf = download_to_vec(&self.client, &media).await.map_err(to_rpc_error)?;
        Ok(buf)
    }

    async fn upload_video(&self, channel: &ResolvedChannel, input: VideoUploadInput, progress: ProgressSink<'_>, cancel: &CancelFlag) -> Result<UploadedRef, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;

        let total = tokio::fs::metadata(&input.file_path).await.map_err(|e| IngestRpcError::Other(e.to_string()))?.len();
        if total == 0 {
            return Err(IngestRpcError::Other("file rỗng".into()));
        }
        let input_file = self.multi_connection_upload(&input.file_path, total, &input.file_name, progress, cancel).await?;
        let uploaded: Uploaded = Uploaded::from_raw(input_file);

        let mut msg = InputMessage::new()
            .document(uploaded)
            .attribute(Attribute::Video { round_message: false, supports_streaming: true, duration: std::time::Duration::from_secs(input.duration_sec as u64), w: input.width as i32, h: input.height as i32 })
            .attribute(Attribute::FileName(input.file_name.clone()));
        if let Some(caption) = &input.caption {
            msg = msg.text(caption.clone());
        }
        if let Some(thumb_path) = &input.thumbnail_path {
            let thumb = self.client.upload_file(thumb_path).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
            msg = msg.thumbnail(thumb);
        }

        let sent = self.client.send_message(peer_ref, msg).await.map_err(to_rpc_error)?;
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }

    async fn upload_subtitle(&self, channel: &ResolvedChannel, input: SubtitleUploadInput) -> Result<UploadedRef, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;
        let uploaded = self.client.upload_file(&input.file_path).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
        let msg = InputMessage::new().document(uploaded).attribute(Attribute::FileName(input.file_name.clone()));
        let sent = self.client.send_message(peer_ref, msg).await.map_err(to_rpc_error)?;
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }

    async fn publish_catalog(&self, channel: &ResolvedChannel, json_bytes: &[u8], previous_msg_id: Option<i64>) -> Result<UploadedRef, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;

        let mut cursor = std::io::Cursor::new(json_bytes.to_vec());
        let uploaded = self.client.upload_stream(&mut cursor, json_bytes.len(), "catalog.v1.json".to_string()).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
        let msg = InputMessage::new().document(uploaded).attribute(Attribute::FileName("catalog.v1.json".to_string()));
        let sent = self.client.send_message(peer_ref, msg).await.map_err(to_rpc_error)?;

        self.client.pin_message(peer_ref, sent.id()).await.map_err(to_rpc_error)?;
        if let Some(prev) = previous_msg_id {
            self.client.delete_messages(peer_ref, &[prev as i32]).await.map_err(to_rpc_error)?;
        }
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }
}

impl GrammersIngestRpc {
    /// Tự mở `N_CONNS` connection MTProto RAW SONG SONG THẬT tới home DC,
    /// tái dùng `auth_key` đã có từ `SenderPool` (đọc qua `session.dc_option()`
    /// — CHÍNH XÁC cách `SenderPool` tự làm nội bộ khi kết nối lần đầu tới
    /// một DC đã biết auth_key, xem `grammers-mtsender::sender_pool.rs::
    /// connect_sender()`, nhánh "reuse the existing auth key"). Khác hẳn
    /// `upload_stream()` (multiplex N request logic trên MỘT connection) —
    /// đây là N SOCKET TCP thật, mỗi cái xử lý tuần tự phần part của mình.
    ///
    /// Điều kiện tiên quyết: phải có ít nhất một RPC thành công trước đó
    /// (`resolve_channel()`) để `dc_option.auth_key` đã được `SenderPool`
    /// ghi vào session — nếu chưa, trả lỗi rõ ràng thay vì rơi vào trạng
    /// thái khó hiểu.
    async fn multi_connection_upload(&self, path: &Path, total: u64, file_name: &str, progress: ProgressSink<'_>, cancel: &CancelFlag) -> Result<tl::enums::InputFile, IngestRpcError> {
        const PART_SIZE: u64 = 512 * 1024;
        const N_CONNS: usize = 3;

        let total_parts = i32::try_from(total.div_ceil(PART_SIZE)).map_err(|_| IngestRpcError::Other("file quá lớn cho i32 file_total_parts".into()))?;
        let n_workers = N_CONNS.min(total_parts.max(1) as usize).max(1);

        let home_dc = self.session.home_dc_id().map_err(|e| IngestRpcError::Other(format!("home_dc_id(): {e}")))?;
        let dc_option = self.session.dc_option(home_dc).map_err(|e| IngestRpcError::Other(format!("dc_option(): {e}")))?.ok_or_else(|| IngestRpcError::Other(format!("không có dc_option cho DC{home_dc}")))?;
        let auth_key = dc_option.auth_key.ok_or_else(|| IngestRpcError::Other("chưa có auth_key trong session — gọi resolve_channel() (hoặc bất kỳ RPC nào) trước upload_video()".into()))?;
        let address: SocketAddr = dc_option.ipv4.into();

        let init_connection = tl::functions::InvokeWithLayer {
            layer: tl::LAYER,
            query: tl::functions::InitConnection {
                api_id: self.api_id,
                device_model: "tsmc-ingest-desktop".to_string(),
                system_version: std::env::consts::OS.to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                system_lang_code: "en".to_string(),
                lang_pack: String::new(),
                lang_code: "en".to_string(),
                proxy: None,
                params: None,
                query: tl::functions::help::GetConfig {},
            },
        };

        let mut senders: Vec<Sender<transport::Full, grammers_mtproto::mtp::Encrypted>> = Vec::with_capacity(n_workers);
        for _ in 0..n_workers {
            let mut sender = connect_with_auth(transport::Full::new(), grammers_mtsender::ServerAddr::Tcp { address }, auth_key)
                .await
                .map_err(|e| IngestRpcError::Other(format!("mở connection RAW thất bại: {e}")))?;
            // Đăng ký thông tin app trên connection MỚI — cùng việc
            // SenderPool tự làm cho connection chính (connect_sender()),
            // phòng trường hợp server yêu cầu InitConnection trước khi
            // chấp nhận RPC khác trên một connection mới toanh.
            sender.invoke(&init_connection).await.map_err(|e| IngestRpcError::Other(format!("init_connection trên RAW sender thất bại: {e}")))?;
            senders.push(sender);
        }

        let bytes_done = std::sync::atomic::AtomicU64::new(0);
        let file_id: i64 = rand::random();

        let uploads = senders.iter_mut().enumerate().map(|(worker_idx, sender)| {
            let bytes_done = &bytes_done;
            async move {
                use tokio::io::{AsyncReadExt, AsyncSeekExt};
                let mut file = tokio::fs::File::open(path).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
                let mut part = worker_idx as i32;
                while part < total_parts {
                    if cancel.is_cancelled() {
                        return Err(IngestRpcError::Cancelled);
                    }
                    let offset = part as u64 * PART_SIZE;
                    let this_len = PART_SIZE.min(total - offset) as usize;
                    let mut buf = vec![0u8; this_len];
                    file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
                    file.read_exact(&mut buf).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;

                    let ok = sender
                        .invoke(&tl::functions::upload::SaveBigFilePart { file_id, file_part: part, file_total_parts: total_parts, bytes: buf })
                        .await
                        .map_err(to_rpc_error)?;
                    if !ok {
                        return Err(IngestRpcError::Other(format!("server từ chối lưu part {part}")));
                    }

                    let done = bytes_done.fetch_add(this_len as u64, std::sync::atomic::Ordering::SeqCst) + this_len as u64;
                    progress(UploadProgress { bytes_sent: done.min(total), total_bytes: total });
                    part += n_workers as i32;
                }
                Ok::<(), IngestRpcError>(())
            }
        });
        futures_util::future::try_join_all(uploads).await?;

        Ok(tl::enums::InputFile::Big(tl::types::InputFileBig { id: file_id, parts: total_parts, name: file_name.to_string() }))
    }
}

/// `Client::download_media()` (0.10.0) chỉ ghi ra FILE (`P: AsRef<Path>`),
/// không có bản nhận `Vec<u8>` trực tiếp. Dùng `iter_download` (cấp thấp
/// hơn, trả từng chunk `Vec<u8>`) để gom vào bộ nhớ, đúng nhu cầu
/// `download_document()`/`read_pinned_catalog()` (đọc lại byte-chính-xác mà
/// không cần ghi file tạm).
async fn download_to_vec<D: grammers_client::media::Downloadable>(client: &Client, item: &D) -> Result<Vec<u8>, InvocationError> {
    let mut out = Vec::new();
    let mut iter = client.iter_download(item);
    while let Some(chunk) = iter.next().await? {
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
