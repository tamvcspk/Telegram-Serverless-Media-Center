//! Implement `IngestRpc` (ingest-rpc-trait) bằng ferogram 0.6.5.
//!
//! Phát hiện thật khi viết file này (đọc trực tiếp mã nguồn crate đã tải về
//! `~/.cargo/registry/src/...`, không đoán từ trí nhớ — cùng phương pháp áp
//! dụng cho r3-grammers):
//!
//! - `media::UploadedFile` (kết quả `upload_file`/`upload_sequential`) có
//!   field `inner: tl::enums::InputFile` nhưng field đó là `pub(crate)` —
//!   KHÔNG lộ ra ngoài crate. Các hàm công khai để đổi thành `InputMedia`
//!   (`as_document_media()`, `as_auto_media()`) chỉ gắn
//!   `DocumentAttributeFilename`, không có cách nào công khai để thêm
//!   `DocumentAttributeVideo(supportsStreaming)` hay `thumb`. **Xác nhận
//!   thật bằng ảnh chụp màn hình (2026-09-05):** upload qua đường này hiện
//!   ra như document trần trụi trong Telegram thật, không phải video.
//!   **Đã THỬ VÁ và BỎ (2026-09-05):** tự viết chunk-upload gọi thẳng
//!   `client.invoke(&SaveBigFilePart{...})` (public) để né field private —
//!   chạy thật ném `ConnectionReset` ở ~1.7%. Gốc rễ: ferogram cố tình tách
//!   RIÊNG một "transfer pool" (auth key/seq_no/msg_id/salt/transport
//!   Abridged hoàn toàn cách biệt session chính, xem doc comment
//!   `rpc_transfer_on_dc_pub` — `pub(crate)`, `client/mod.rs`) để tránh
//!   `Crypto(InvalidBuffer)` khi trộn traffic file với luồng update/dialog
//!   trên cùng kết nối. `client.invoke()` công khai đi qua pool CHÍNH, không
//!   phải transfer pool đó — **không có cách nào từ ngoài crate vừa dùng
//!   đúng transfer pool (an toàn) vừa tự chọn `InputMedia`/attributes**
//!   (hàm route qua transfer pool không public). Đây là giới hạn kiến trúc
//!   thật của ferogram 0.6.5, không phải một bug có thể né bằng code cẩn
//!   thận hơn — xem chi tiết + số liệu ở `upload_video()` bên dưới và
//!   docs/spikes/README.md#spike-10. Đã quay lại `upload_file()` (đường AN
//!   TOÀN, đã verify throughput thật) — M2 vẫn treo cho R4 qua API công
//!   khai hiện tại, chấp nhận là giới hạn thật, không tiếp tục né tránh.
//! - `Client::delete_messages(ids, revoke)` PUBLIC chỉ gọi
//!   `messages.deleteMessages` (không nhận peer) — đúng cho DM/group
//!   thường, KHÔNG đúng cho supergroup/channel (Telegram yêu cầu
//!   `channels.deleteMessages` + access_hash cho trường hợp đó).
//!   `peer_cache` giữ access_hash là `pub(crate)`, không lộ ra ngoài — phải
//!   tự trích access_hash từ danh sách `chats` trả về bởi `get_chat_full()`
//!   (public) rồi tự `invoke()` raw `channels.DeleteMessages`, xem
//!   `publish_catalog()` bên dưới.
//! - Bù lại: `InvocationError::flood_wait_seconds()` (session.rs) và
//!   `TransferHandle` (progress/pause/cancel có sẵn, xem
//!   `examples/progress_transfer.rs`) tốt hơn hẳn grammers ở đúng hai điểm
//!   spike này cần đo (M5/M6) — không phải mọi thứ đều bất lợi cho R4.

use std::collections::HashMap;
use std::future::IntoFuture;
use std::sync::Mutex;

use async_trait::async_trait;
use ferogram::{Client, InputMessage, InvocationError, PeerRef, TransferHandle, TransferProgress};
use ferogram::tl;
use ingest_rpc_trait::{
    CancelFlag, IngestRpc, IngestRpcError, PinnedCatalog, ProgressSink, ResolvedChannel, SubtitleUploadInput,
    UploadProgress, UploadedRef, VideoUploadInput,
};

fn to_rpc_error(err: InvocationError) -> IngestRpcError {
    if let Some(seconds) = err.flood_wait_seconds() {
        return IngestRpcError::FloodWait { seconds };
    }
    IngestRpcError::Other(err.to_string())
}

#[derive(Clone)]
struct ChannelInfo {
    channel_id: i64,
    access_hash: i64,
}

pub struct FerogramIngestRpc {
    client: Client,
    cache: Mutex<HashMap<String, ChannelInfo>>,
}

impl FerogramIngestRpc {
    pub fn new(client: Client) -> Self {
        Self { client, cache: Mutex::new(HashMap::new()) }
    }

    fn info_for(&self, channel: &ResolvedChannel) -> Result<ChannelInfo, IngestRpcError> {
        self.cache.lock().unwrap().get(&channel.id).cloned().ok_or_else(|| IngestRpcError::Other(format!("channel {} không có trong cache — gọi resolve_channel() trước", channel.id)))
    }

    fn input_channel(info: &ChannelInfo) -> tl::enums::InputChannel {
        tl::enums::InputChannel::InputChannel(tl::types::InputChannel { channel_id: info.channel_id, access_hash: info.access_hash })
    }

    /// `PeerRef::from(i64)` diễn giải số nguyên theo định dạng "Bot-API
    /// encoded ID" (`-100xxxxxxxxxx` cho channel) — KHÔNG phải `channel_id`
    /// trần của TL layer mà `ResolvedChannel.id`/`ChannelInfo` đang giữ.
    /// Dùng thẳng `tl::enums::Peer::Channel` (docs: "returned as-is, zero
    /// cost") để tránh nhầm channel thành user — phát hiện thật khi so
    /// dòng doc "Bot-API encoded numeric ID" ở `resolve.rs` với dữ liệu
    /// mình đang có trong tay.
    fn peer_ref(channel_id: i64) -> PeerRef {
        PeerRef::from(tl::enums::Peer::Channel(tl::types::PeerChannel { channel_id }))
    }
}

#[async_trait]
impl IngestRpc for FerogramIngestRpc {
    async fn resolve_channel(&self, channel_ref: &str) -> Result<ResolvedChannel, IngestRpcError> {
        let full = self.client.get_chat_full(channel_ref).await.map_err(to_rpc_error)?;
        let tl::enums::messages::ChatFull::ChatFull(full) = full;
        // PHÁT HIỆN THẬT (chạy thật lần đầu, kênh broadcast thật
        // `tsmc_mediacenter`): `tl::enums::ChatFull` có BA biến thể —
        // `ChatFull` (basic group), `ChannelFull` (channel/broadcast —
        // đúng trường hợp của spike này), `CommunityFull`. Code cũ chỉ
        // khớp biến thể `ChatFull` nên panic-error ngay ở kênh thật đầu
        // tiên; grammers-tl-types gọi biến thể tương ứng là `Full` (khác
        // tên hẳn) — hai thư viện generate tên khác nhau cho cùng một TL
        // constructor `channelFull`, không suy đoán được, phải đọc code
        // generate thật ở `target/debug/build/*/out/generated_enums.rs`.
        let tl::enums::ChatFull::ChannelFull(chat_full) = full.full_chat else {
            return Err(IngestRpcError::Other("full_chat không phải ChannelFull — \"channel_ref\" không phải channel/broadcast (spike chỉ nhắm channel/broadcast)".into()));
        };
        let channel_tl = full
            .chats
            .iter()
            .find_map(|c| match c {
                tl::enums::Chat::Channel(ch) if ch.id == chat_full.id => Some(ch.clone()),
                _ => None,
            })
            .ok_or_else(|| IngestRpcError::Other("không tìm thấy channel tương ứng trong ChatFull.chats".into()))?;

        let access_hash = channel_tl.access_hash.unwrap_or(0);
        let id = channel_tl.id.to_string();
        let resolved = ResolvedChannel { id: id.clone(), access_hash: access_hash.to_string(), title: channel_tl.title.clone(), is_own: channel_tl.creator };
        self.cache.lock().unwrap().insert(id, ChannelInfo { channel_id: channel_tl.id, access_hash });
        Ok(resolved)
    }

    async fn check_write_permission(&self, channel: &ResolvedChannel) -> Result<bool, IngestRpcError> {
        Ok(channel.is_own)
    }

    async fn read_pinned_catalog(&self, channel: &ResolvedChannel) -> Result<Option<PinnedCatalog>, IngestRpcError> {
        let info = self.info_for(channel)?;
        let full = self.client.invoke(&tl::functions::channels::GetFullChannel { channel: Self::input_channel(&info) }).await.map_err(to_rpc_error)?;
        let tl::enums::messages::ChatFull::ChatFull(full) = full;
        // Cùng phát hiện thật ghi ở resolve_channel() — biến thể đúng là
        // ChannelFull, không phải ChatFull.
        let tl::enums::ChatFull::ChannelFull(chat_full) = full.full_chat else {
            return Ok(None);
        };
        let Some(pinned_id) = chat_full.pinned_msg_id else {
            return Ok(None);
        };
        self.download_pinned_or_msg(channel, pinned_id).await
    }

    async fn download_document(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<Vec<u8>, IngestRpcError> {
        let peer: PeerRef = Self::peer_ref(channel.id.parse::<i64>().map_err(|e| IngestRpcError::Other(e.to_string()))?);
        let messages = self.client.get_messages(peer, &[msg_id as i32]).await.map_err(to_rpc_error)?;
        let message = messages.into_iter().next().ok_or_else(|| IngestRpcError::Other(format!("message {msg_id} không tồn tại")))?;
        let media = message.media().ok_or_else(|| IngestRpcError::Other(format!("message {msg_id} không có media")))?;
        let mut buf = Vec::new();
        self.client.download(media, &mut buf, None).await.map_err(to_rpc_error)?;
        Ok(buf)
    }

    async fn upload_video(&self, channel: &ResolvedChannel, input: VideoUploadInput, progress: ProgressSink<'_>, cancel: &CancelFlag) -> Result<UploadedRef, IngestRpcError> {
        let info = self.info_for(channel)?;
        let handle = TransferHandle::new();

        // Bọc CancelFlag (trait dùng chung R3/R4) sang TransferHandle của
        // ferogram — hai cơ chế huỷ khác nhau, không tự động nối với nhau.
        let cancel_watch = {
            let handle = handle.clone();
            let cancel = cancel.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    if cancel.is_cancelled() {
                        handle.cancel();
                        break;
                    }
                    if handle.is_cancelled() {
                        break;
                    }
                }
            })
        };

        // ĐÃ THỬ VÀ BỎ (2026-09-05): tự viết chunk-upload gọi thẳng
        // `client.invoke(&tl::functions::upload::SaveBigFilePart{...})` để
        // né field `inner` private của `UploadedFile` (xem module doc
        // comment đầu file). Chạy thật: `ConnectionReset` ở ~1.7% (14 part).
        // Gốc rễ đọc được từ chính doc comment `rpc_transfer_on_dc_pub`
        // (`pub(crate)`, `client/mod.rs`): ferogram cố tình tách RIÊNG một
        // "transfer pool" — auth key/seq_no/msg_id/salt RIÊNG, transport
        // Abridged RIÊNG, hoàn toàn cách biệt session chính — "để tránh
        // Crypto(InvalidBuffer) do trộn traffic file với luồng
        // update/dialog trên cùng kết nối". `client.invoke()` công khai đi
        // qua pool CHÍNH (session thường), không phải transfer pool đó.
        // Kết quả: KHÔNG có cách nào từ bên ngoài crate vừa dùng đúng
        // transfer pool (an toàn) vừa tự chọn `InputMedia`/attributes
        // (`rpc_transfer_on_dc_pub` không public) — đây là giới hạn kiến
        // trúc thật, không phải thiếu sót nhỏ có thể né bằng cách viết cẩn
        // thận hơn. Quay lại `upload_file()` (đường AN TOÀN, đã verify
        // throughput thật 28.6% baseline) — chấp nhận M2 vẫn treo cho R4
        // qua API công khai hiện tại.
        let upload_fut = self.client.upload_file(&input.file_path).handle(&handle).into_future();
        tokio::pin!(upload_fut);
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(800));
        let uploaded = loop {
            tokio::select! {
                res = &mut upload_fut => break res,
                _ = ticker.tick() => {
                    let p: TransferProgress = handle.progress();
                    progress(UploadProgress { bytes_sent: p.done, total_bytes: p.total });
                }
            }
        };
        cancel_watch.abort();
        let uploaded = uploaded.map_err(|e| if cancel.is_cancelled() || handle.is_cancelled() { IngestRpcError::Cancelled } else { to_rpc_error(e) })?;

        // GIỚI HẠN THẬT, XÁC NHẬN HAI LẦN (ảnh chụp màn hình + phân tích
        // transfer-pool ở trên): as_document_media() chỉ gắn Filename —
        // KHÔNG có DocumentAttributeVideo/supportsStreaming. Chưa tìm được
        // cách vá an toàn qua API công khai của ferogram 0.6.5.
        let media = uploaded.as_document_media();
        let msg = InputMessage::text(input.caption.clone().unwrap_or_default()).copy_media(media);
        let peer = Self::peer_ref(info.channel_id);
        let sent = self.client.send_message(peer, msg).await.map_err(to_rpc_error)?;
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }

    async fn upload_subtitle(&self, channel: &ResolvedChannel, input: SubtitleUploadInput) -> Result<UploadedRef, IngestRpcError> {
        let info = self.info_for(channel)?;
        let uploaded = self.client.upload_file(&input.file_path).await.map_err(to_rpc_error)?;
        let media = uploaded.as_document_media();
        let peer = Self::peer_ref(info.channel_id);
        let sent = self.client.send_message(peer, InputMessage::text("").copy_media(media)).await.map_err(to_rpc_error)?;
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }

    async fn publish_catalog(&self, channel: &ResolvedChannel, json_bytes: &[u8], previous_msg_id: Option<i64>) -> Result<UploadedRef, IngestRpcError> {
        let info = self.info_for(channel)?;
        let uploaded = self.client.upload(std::io::Cursor::new(json_bytes.to_vec()), "catalog.v1.json").await.map_err(to_rpc_error)?;
        let media = uploaded.as_document_media();
        let peer = Self::peer_ref(info.channel_id);
        let sent = self.client.send_message(peer.clone(), InputMessage::text("").copy_media(media)).await.map_err(to_rpc_error)?;

        self.client.pin_message(peer, sent.id(), true).await.map_err(to_rpc_error)?;

        if let Some(prev) = previous_msg_id {
            // channels.deleteMessages RAW — public delete_messages() chỉ
            // gọi messages.deleteMessages (không peer), sai cho channel
            // (xem doc comment đầu file).
            self.client
                .invoke(&tl::functions::channels::DeleteMessages { channel: Self::input_channel(&info), id: vec![prev as i32] })
                .await
                .map_err(to_rpc_error)?;
        }
        Ok(UploadedRef { msg_id: sent.id() as i64 })
    }
}

impl FerogramIngestRpc {
    async fn download_pinned_or_msg(&self, channel: &ResolvedChannel, msg_id: i32) -> Result<Option<PinnedCatalog>, IngestRpcError> {
        let peer = Self::peer_ref(channel.id.parse::<i64>().map_err(|e| IngestRpcError::Other(e.to_string()))?);
        let messages = self.client.get_messages(peer, &[msg_id]).await.map_err(to_rpc_error)?;
        let Some(message) = messages.into_iter().next() else {
            return Ok(None);
        };
        let Some(media) = message.media() else {
            return Ok(None);
        };
        let mut buf = Vec::new();
        self.client.download(media, &mut buf, None).await.map_err(to_rpc_error)?;
        Ok(Some(PinnedCatalog { msg_id: message.id() as i64, publisher_id: message.sender_id().map(|p| format!("{p:?}")).unwrap_or_default(), raw: String::from_utf8_lossy(&buf).into_owned() }))
    }
}
