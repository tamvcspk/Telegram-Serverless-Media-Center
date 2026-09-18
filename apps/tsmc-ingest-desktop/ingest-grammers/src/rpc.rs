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
use grammers_client::media::{Attribute, Media, Uploaded};
use grammers_client::peer::Peer;
use grammers_mtproto::transport;
use grammers_mtsender::{Sender, connect_with_auth};
use grammers_session::Session as _;
use grammers_tl_types as tl;
use ingest_rpc_trait::{
    CancelFlag, ChannelVideoDocument, IngestRpc, IngestRpcError, PinnedCatalog, ProgressSink, ResolvedChannel,
    SubtitleUploadInput, UploadProgress, UploadedRef, VideoUploadInput,
};

use crate::encrypted_session::EncryptedSqliteSession;

/// Ngưỡng an toàn đo được thật ở SPIKE-10 M7 (tài khoản Premium,
/// `tools/spike-10/README.md` § M7): 2.307 GiB (4 726 part @512 KiB) upload
/// thành công, 4.327 GiB (8 862 part) bị Telegram từ chối
/// `FILE_PARTS_INVALID` NGAY LẬP TỨC (server đọc `file_total_parts` từ
/// request part đầu tiên, không đợi upload xong mới báo). Chưa bisect chính
/// xác từng byte trong khoảng đó — dùng con số công khai vẫn được biết tới
/// ("~4000 MB cho tài khoản Premium", **4 000 000 000 byte thập phân — KHÁC
/// 4 GiB nhị phân = 4 294 967 296 byte**) làm trần, nằm gọn giữa hai mốc đã
/// đo (≈7630 part, giữa 4726 và 8862).
const MAX_UPLOAD_BYTES_PREMIUM: u64 = 4_000_000_000;

/// Trần cho tài khoản KHÔNG Premium — số liệu THẬT (không phải suy đoán từ
/// tài liệu công khai), user xác nhận trực tiếp 2026-09-13 sau khi verify
/// bản vá `MAX_UPLOAD_BYTES` cũ (hardcode chung 4GB) vẫn để lọt file 2-4GB
/// cho tài khoản thường, dính `FILE_PARTS_INVALID` thô — xem
/// [ADR-0017 § addendum 2026-09-13](../../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md).
const MAX_UPLOAD_BYTES_FREE: u64 = 2_000_000_000;

/// Đọc cờ Premium từ `tl::enums::User` trả về bởi `Client::get_me()` —
/// `user#31774388` có field `premium:flags.28?true` (xem
/// `grammers-tl-types-0.10.0/tl/api.tl`), `User::Empty` (hiếm, tài khoản đã
/// xoá) coi như không Premium (an toàn hơn — trần thấp hơn).
fn is_premium(raw: &tl::enums::User) -> bool {
    match raw {
        tl::enums::User::User(u) => u.premium,
        tl::enums::User::Empty(_) => false,
    }
}

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
    session: Arc<EncryptedSqliteSession>,
    api_id: i32,
    /// Trần upload THẬT theo tài khoản (4GB Premium / 2GB thường) — đọc một
    /// lần lúc đăng nhập xong qua `get_me()`, xem `is_premium()`. Lỗi đọc
    /// (hiếm — network flake ngay sau đăng nhập) mặc định về trần THẤP hơn
    /// (an toàn hơn là để lọt `FILE_PARTS_INVALID` thô cho tài khoản thường).
    max_upload_bytes: u64,
}

impl GrammersIngestRpc {
    pub async fn new(client: Client, session: Arc<EncryptedSqliteSession>, api_id: i32) -> Self {
        let max_upload_bytes = match client.get_me().await {
            Ok(me) if is_premium(&me.raw) => MAX_UPLOAD_BYTES_PREMIUM,
            _ => MAX_UPLOAD_BYTES_FREE,
        };
        Self { client, cache: Mutex::new(HashMap::new()), session, api_id, max_upload_bytes }
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
        // Chặn TRƯỚC khi mở kết nối — đúng khuyến nghị chưa từng port từ
        // SPIKE-10 M7 (tools/spike-10/README.md § M7: "một implementation
        // client thật phải tự tính total_parts... so với một trần an toàn
        // và chặn ở UI ngay — không phụ thuộc server phản hồi nhanh hay
        // chậm"). Thiếu bước này khiến `sample-4gb.mp4` (4 645 817 639 byte)
        // rơi thẳng vào lỗi giao thức thô `FILE_PARTS_INVALID` khi verify
        // thật 2026-09-13 — đúng file/đúng lỗi SPIKE-10 đã từng gặp, không
        // phải bug mới, chỉ là gap chưa vá.
        if total > self.max_upload_bytes {
            return Err(IngestRpcError::FileTooLarge { max_bytes: self.max_upload_bytes, actual_bytes: total });
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

    /// `Client::sign_out()` bọc thẳng `auth.LogOut` — trả `Ok` cả khi
    /// Telegram báo "không ai đăng nhập" (theo doc comment gốc của
    /// `grammers-client`, method trả `Err` chỉ ở lỗi RPC/mạng thật, KHÔNG
    /// phải ở case "đã đăng xuất từ trước"). Không tự xoá `session.sqlite3`
    /// ở đây — đó là việc của bên gọi (`src-tauri/src/commands.rs`, có
    /// đường dẫn file), giữ đúng ranh giới "`ingest-grammers` thuần MTProto,
    /// không biết gì về app-data" (ADR-0021).
    async fn sign_out(&self) -> Result<(), IngestRpcError> {
        self.client.sign_out().await.map_err(to_rpc_error)?;
        Ok(())
    }

    /// Chunk 100 id/lần — giới hạn an toàn cho `channels.GetMessages` (chưa
    /// thấy tài liệu ghim con số chính thức, 100 là mức dùng phổ biến của
    /// các client MTProto khác cho lời gọi tương tự). `get_messages_by_id()`
    /// (grammers) trả `Vec<Option<Message>>` CÙNG THỨ TỰ với id đưa vào.
    ///
    /// **Bug thật phát hiện lúc verify thiết bị thật (2026-09-15):** `None`
    /// KHÔNG phải tín hiệu duy nhất của "đã bị xoá" — Telegram không lược bỏ
    /// message đã xoá khỏi response của `channels.GetMessages`, mà trả về
    /// biến thể `tl::enums::Message::Empty` (tombstone) cho đúng vị trí id
    /// đó. `Message::peer_id()` (grammers) của biến thể `Empty` rơi về
    /// `fetched_in` (= chính `peer_ref` truyền vào) khi `peer_id` trong TL
    /// rỗng — nghĩa là filter nội bộ của `get_messages_by_id()`
    /// (`m.peer_id() == peer.id`) KHÔNG loại được `Empty`, nó vẫn nằm trong
    /// map kết quả và trả về `Some(Message)`, không phải `None`. Ban đầu chỉ
    /// kiểm `message.is_none()` nên KHÔNG BAO GIỜ phát hiện được message đã
    /// xoá thật (verify thật: xoá tay 1 message, "Đối soát với kênh" không
    /// gắn cờ gì) — vá bằng kiểm thêm biến thể `Empty` ở field `raw` công
    /// khai của `Message`.
    async fn check_deleted_messages(&self, channel: &ResolvedChannel, msg_ids: &[i64]) -> Result<Vec<i64>, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;

        let mut missing = Vec::new();
        for chunk in msg_ids.chunks(100) {
            let ids: Vec<i32> = chunk.iter().map(|&id| id as i32).collect();
            let messages = self.client.get_messages_by_id(peer_ref, &ids).await.map_err(to_rpc_error)?;
            for (id, message) in chunk.iter().zip(messages.into_iter()) {
                let deleted = match &message {
                    None => true,
                    Some(m) => matches!(m.raw, tl::enums::Message::Empty(_)),
                };
                if deleted {
                    missing.push(*id);
                }
            }
        }
        Ok(missing)
    }

    async fn delete_message(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<(), IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;
        self.client.delete_messages(peer_ref, &[msg_id as i32]).await.map_err(to_rpc_error)?;
        Ok(())
    }

    /// Quét TOÀN BỘ lịch sử kênh bằng `iter_messages()` (`messages.getHistory`
    /// không lọc, cùng RPC `fetchHistorySince()` của `gateway-index.ts` dùng)
    /// — KHÔNG dùng `search_messages().filter(InputMessagesFilterDocument)`:
    /// Telegram xếp document có `DocumentAttributeVideo` ("sent as video")
    /// vào filter Video chứ không phải Document, lọc kiểu đó sẽ bỏ sót đúng
    /// thứ cần tìm. Lọc thủ công bằng attribute sau khi tải về, cùng cách
    /// `extractVideoAttributes()` (gateway-index.ts) làm ở web app. Bỏ qua
    /// tombstone `Message::Empty` phòng thủ (cùng kiểu kiểm đã áp dụng ở
    /// `check_deleted_messages`) dù `getHistory` không chắc trả biến thể này.
    async fn scan_channel_videos(&self, channel: &ResolvedChannel) -> Result<Vec<ChannelVideoDocument>, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;

        let mut iter = self.client.iter_messages(peer_ref);
        let mut results = Vec::new();
        while let Some(message) = iter.next().await.map_err(to_rpc_error)? {
            if matches!(message.raw, tl::enums::Message::Empty(_)) {
                continue;
            }
            let Some(Media::Document(doc)) = message.media() else {
                continue;
            };
            let has_video_attr = matches!(
                &doc.raw.document,
                Some(tl::enums::Document::Document(d)) if d.attributes.iter().any(|a| matches!(a, tl::enums::DocumentAttribute::Video(_)))
            );
            if !has_video_attr {
                continue;
            }
            results.push(ChannelVideoDocument {
                msg_id: message.id() as i64,
                file_name: doc.name().map(str::to_string),
                size: doc.size().unwrap_or(0) as u64,
                mime_type: doc.mime_type().map(str::to_string),
                duration_sec: doc.duration(),
            });
        }
        Ok(results)
    }

    /// Upload poster (bytes đã tải sẵn ở tầng gọi, thường từ TMDB) — cùng
    /// khuôn `publish_catalog()` (stream thẳng từ bộ nhớ qua `upload_stream`,
    /// không ghi file tạm), nhưng KHÔNG pin/không xoá bản cũ (một message
    /// độc lập, không phải catalog). `.document(...)` (không có attribute
    /// `Video`) giữ nguyên dạng Document — xem doc comment đầu file.
    async fn upload_poster(&self, channel: &ResolvedChannel, file_name: String, bytes: Vec<u8>) -> Result<UploadedRef, IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;

        let len = bytes.len();
        let mut cursor = std::io::Cursor::new(bytes);
        let uploaded = self.client.upload_stream(&mut cursor, len, file_name.clone()).await.map_err(|e| IngestRpcError::Other(e.to_string()))?;
        let msg = InputMessage::new().document(uploaded).attribute(Attribute::FileName(file_name));
        let sent = self.client.send_message(peer_ref, msg).await.map_err(to_rpc_error)?;
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }

    /// `messages.editMessage` với `media: None` (không truyền media mới) —
    /// theo tài liệu TL công khai, bỏ trống `media` giữ NGUYÊN media hiện có
    /// của message, chỉ đổi `message`/text (= caption với message có
    /// document/photo đính kèm). `InputMessage::new().text(caption)` không
    /// gắn media nào nên đúng ý — KHÔNG dùng để đổi file đính kèm.
    async fn edit_message_caption(&self, channel: &ResolvedChannel, msg_id: i64, caption: String) -> Result<(), IngestRpcError> {
        let peer = self.peer_for(channel)?;
        let peer_ref = peer.to_ref().await.map_err(|e| IngestRpcError::Other(e.to_string()))?.ok_or_else(|| IngestRpcError::Other("không lấy được PeerRef".into()))?;
        self.client.edit_message(peer_ref, msg_id as i32, InputMessage::new().text(caption)).await.map_err(to_rpc_error)?;
        Ok(())
    }

    fn max_upload_bytes(&self) -> u64 {
        self.max_upload_bytes
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
