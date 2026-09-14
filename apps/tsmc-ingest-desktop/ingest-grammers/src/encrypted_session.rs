//! `Session` (`grammers_session`) tự implement, mã hoá TOÀN BỘ file SQLite
//! (auth_key/DC options/peer cache/update state) — ADR-0021.
//!
//! **Vì sao không dùng thẳng `grammers_session::storages::SqliteSession`
//! (đã dùng trước ADR-0021):** crate đó mở file qua
//! `libsql::Builder::new_local(path).build()`, không có cách nào truyền
//! `encryption_config` từ bên ngoài — không có tham số, không có cờ, không
//! có hook. `grammers_session::Session` là một trait CÔNG KHAI với ghi chú
//! thẳng trong doc comment gốc: *"If none fit your needs, you can also
//! implement [`crate::Session`] yourself"* — đây chính là đường đó.
//!
//! **Đây LÀ một bản fork có chủ đích, không phải viết mới:** toàn bộ schema
//! SQL (5 bảng: `dc_home`/`dc_option`/`peer_info`/`update_state`/
//! `channel_state`) và logic của tám method `Session` COPY NGUYÊN VẸN từ
//! `grammers-session` 0.10.0 `src/storages/sqlite.rs` (Apache-2.0 OR MIT,
//! xem `LICENSE-APACHE`/`LICENSE-MIT` tại
//! <https://github.com/Lonami/grammers>) — CHỈ khác đúng MỘT chỗ:
//! `SqliteSession::open()` gọi `.build()` trần, còn `open()` ở đây gọi
//! `.encryption_config(EncryptionConfig::new(Cipher::Aes256Cbc, key))` trước
//! `.build()`. Không tự sáng tác lại logic session — sao chép đúng nguồn đã
//! được `grammers` project tự test (`exercise_sqlite_session`, đã port lại
//! nguyên bộ test đó ở cuối file này) để giảm rủi ro tự tay viết sai một
//! trong tám method của trait.
//!
//! **`DEFAULT_DC`/`KNOWN_DC_OPTIONS` bị COPY THỦ CÔNG** (không import được —
//! `pub(crate)` trong `grammers-session`, chỉ dùng được TỪ BÊN TRONG crate
//! đó). Giá trị là 5 địa chỉ IP datacenter Telegram công khai (tài liệu
//! MTProto chính thức, không phải bí mật) — xem
//! `grammers-session-0.10.0/src/dc_options.rs` nếu cần đối chiếu lại.
//!
//! **RÀNG BUỘC BẮT BUỘC (ADR-0021 điều kiện #1): `libsql` trong
//! `[workspace.dependencies]` PHẢI ghim CỨNG đúng version
//! `grammers-session` 0.10.0 dùng nội bộ (hiện là `=0.9.30`).** Khác một
//! phiên bản là khác schema/API tiềm ẩn — module này copy tay theo ĐÚNG một
//! bản `sqlite.rs`, không tự thích nghi runtime. Nâng cấp `grammers-session`
//! HOẶC `libsql` bắt buộc đối chiếu lại `sqlite.rs` gốc của bản mới (link ở
//! trên) trước khi merge — xem checklist ở
//! [ADR-0021](../../../docs/adr/0021-ma-hoa-session-sqlite-qua-session-tu-implement.md).

use std::collections::HashMap;
use std::fmt;
use std::net::AddrParseError;
use std::path::Path;
use std::sync::Mutex;

use bytes::Bytes;
use grammers_session::types::{
    ChannelKind, ChannelState, DcOption, PeerAuth, PeerId, PeerInfo, PeerKind, UpdateState,
    UpdatesState,
};
use grammers_session::{BoxFuture, Session};
use libsql::{Cipher, EncryptionConfig, named_params, params};
use tokio::sync::Mutex as AsyncMutex;

const VERSION: i64 = 1;

/// Copy tay từ `grammers_session::dc_options::DEFAULT_DC` — `pub(crate)` ở
/// crate gốc, không import được. Xem doc comment đầu file.
const DEFAULT_DC: i32 = 2;

fn ipv4(a: u8, b: u8, c: u8, d: u8) -> std::net::SocketAddrV4 {
    std::net::SocketAddrV4::new(std::net::Ipv4Addr::new(a, b, c, d), 443)
}

// 8 tham số khớp NGUYÊN VẸN chữ ký `ipv6()` gốc của
// `grammers-session-0.10.0/src/dc_options.rs` (dễ đối chiếu tay khi nâng
// version, xem doc comment đầu file) — không gộp thành mảng/struct chỉ để
// né lint này.
#[allow(clippy::too_many_arguments)]
fn ipv6(a: u16, b: u16, c: u16, d: u16, e: u16, f: u16, g: u16, h: u16) -> std::net::SocketAddrV6 {
    std::net::SocketAddrV6::new(std::net::Ipv6Addr::new(a, b, c, d, e, f, g, h), 443, 0, 0)
}

/// Copy tay từ `grammers_session::dc_options::KNOWN_DC_OPTIONS` — 5 địa chỉ
/// datacenter Telegram công khai (functions::help::GetConfig), KHÔNG phải bí
/// mật. Xem doc comment đầu file.
fn known_dc_options() -> [DcOption; 5] {
    [
        DcOption { id: 1, ipv4: ipv4(149, 154, 175, 53), ipv6: ipv6(0x2001, 0xb28, 0xf23d, 0xf001, 0, 0, 0, 0xa), auth_key: None },
        DcOption { id: 2, ipv4: ipv4(149, 154, 167, 41), ipv6: ipv6(0x2001, 0x67c, 0x4e8, 0xf002, 0, 0, 0, 0xa), auth_key: None },
        DcOption { id: 3, ipv4: ipv4(149, 154, 175, 100), ipv6: ipv6(0x2001, 0xb28, 0xf23d, 0xf003, 0, 0, 0, 0xa), auth_key: None },
        DcOption { id: 4, ipv4: ipv4(149, 154, 167, 92), ipv6: ipv6(0x2001, 0x67c, 0x4e8, 0xf004, 0, 0, 0, 0xa), auth_key: None },
        DcOption { id: 5, ipv4: ipv4(91, 108, 56, 104), ipv6: ipv6(0x2001, 0xb28, 0xf23f, 0xf005, 0, 0, 0, 0xa), auth_key: None },
    ]
}

struct Database(libsql::Connection);

struct Cache {
    home_dc: i32,
    dc_options: HashMap<i32, DcOption>,
}

/// SQLite-based storage MÃ HOÁ TOÀN BỘ FILE — thay
/// `grammers_session::storages::SqliteSession` (ADR-0021).
pub struct EncryptedSqliteSession {
    database: AsyncMutex<Database>,
    cache: Mutex<Cache>,
}

#[derive(Debug)]
pub enum EncryptedSessionError {
    Poisoned,
    AddrParse(AddrParseError),
    Sql(libsql::Error),
    InvalidAuthKeyLength(usize),
}

impl std::error::Error for EncryptedSessionError {}

impl fmt::Display for EncryptedSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EncryptedSessionError::Poisoned => write!(f, "session lock is poisoned"),
            EncryptedSessionError::AddrParse(_) => write!(f, "invalid socket address syntax"),
            EncryptedSessionError::Sql(err) => write!(f, "{err}"),
            EncryptedSessionError::InvalidAuthKeyLength(actual) => {
                write!(f, "invalid auth_key length: expected 256, got {actual}")
            }
        }
    }
}

impl From<AddrParseError> for EncryptedSessionError {
    fn from(x: AddrParseError) -> Self {
        Self::AddrParse(x)
    }
}

impl From<libsql::Error> for EncryptedSessionError {
    fn from(x: libsql::Error) -> Self {
        Self::Sql(x)
    }
}

#[repr(u8)]
enum PeerSubtype {
    UserSelf = 1,
    UserBot = 2,
    UserSelfBot = 3,
    Megagroup = 4,
    Broadcast = 8,
    Gigagroup = 12,
}

impl Database {
    async fn init(&self) -> libsql::Result<()> {
        let mut user_version: i64 = self.fetch_one("PRAGMA user_version", params![], |row| row.get(0)).await?.unwrap_or(0);
        if user_version == VERSION {
            return Ok(());
        }

        if user_version == 0 {
            self.migrate_v0_to_v1().await?;
            user_version += 1;
        }
        if user_version == VERSION {
            // Không bind được tham số PRAGMA, nhưng VERSION không phải input do người dùng nhập.
            self.0.execute(&format!("PRAGMA user_version = {VERSION}"), params![]).await?;
        }
        Ok(())
    }

    async fn migrate_v0_to_v1(&self) -> libsql::Result<()> {
        let transaction = self.begin_transaction().await?;
        transaction
            .execute(
                "CREATE TABLE dc_home (
                dc_id INTEGER NOT NULL,
                PRIMARY KEY(dc_id))",
                params![],
            )
            .await?;
        transaction
            .execute(
                "CREATE TABLE dc_option (
                dc_id INTEGER NOT NULL,
                ipv4 TEXT NOT NULL,
                ipv6 TEXT NOT NULL,
                auth_key BLOB,
                PRIMARY KEY (dc_id))",
                params![],
            )
            .await?;
        transaction
            .execute(
                "CREATE TABLE peer_info (
                peer_id INTEGER NOT NULL,
                hash INTEGER,
                subtype INTEGER,
                PRIMARY KEY (peer_id))",
                params![],
            )
            .await?;
        transaction
            .execute(
                "CREATE TABLE update_state (
                pts INTEGER NOT NULL,
                qts INTEGER NOT NULL,
                date INTEGER NOT NULL,
                seq INTEGER NOT NULL)",
                params![],
            )
            .await?;
        transaction
            .execute(
                "CREATE TABLE channel_state (
                peer_id INTEGER NOT NULL,
                pts INTEGER NOT NULL,
                PRIMARY KEY (peer_id))",
                params![],
            )
            .await?;

        transaction.commit().await?;
        Ok(())
    }

    async fn begin_transaction(&self) -> libsql::Result<libsql::Transaction> {
        self.0.transaction().await
    }

    async fn fetch_one<T, P: libsql::params::IntoParams, F: FnOnce(libsql::Row) -> libsql::Result<T>>(
        &self,
        statement: &str,
        params: P,
        select: F,
    ) -> libsql::Result<Option<T>> {
        let mut statement = self.0.prepare(statement).await?;
        let result = statement.query_row(params).await;
        match result {
            Ok(value) => Ok(Some(select(value)?)),
            Err(libsql::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    async fn fetch_all<T, P: libsql::params::IntoParams, F: FnMut(libsql::Row) -> Result<T, EncryptedSessionError>>(
        &self,
        statement: &str,
        params: P,
        mut select: F,
    ) -> Result<Vec<T>, EncryptedSessionError> {
        let statement = self.0.prepare(statement).await?;
        let mut rows = statement.query(params).await?;
        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(select(row)?);
        }
        Ok(result)
    }
}

impl EncryptedSqliteSession {
    /// Mở/khôi phục session SQLite MÃ HOÁ tại `path` — `encryption_key` PHẢI
    /// giống hệt lần mở trước (nguồn sự thật: `secret_store.rs` ở
    /// `src-tauri`, sinh MỘT LẦN, lưu qua keyring/fallback file) — sai key
    /// khiến libsql trả lỗi đọc file ngay (không phải mất dữ liệu, DB không
    /// tự xoá, chỉ không mở được cho tới khi có đúng key).
    pub async fn open<P: AsRef<Path>>(path: P, encryption_key: Bytes) -> Result<Self, EncryptedSessionError> {
        let conn = libsql::Builder::new_local(path)
            .encryption_config(EncryptionConfig::new(Cipher::Aes256Cbc, encryption_key))
            .build()
            .await?
            .connect()?;
        let db = Database(conn);
        db.init().await?;

        let home_dc = db.fetch_one("SELECT * FROM dc_home LIMIT 1", named_params![], |row| row.get::<i32>(0)).await?.unwrap_or(DEFAULT_DC);

        let dc_options = db
            .fetch_all("SELECT * FROM dc_option", named_params![], |row| {
                Ok(DcOption {
                    id: row.get::<i32>(0)?,
                    ipv4: row.get::<String>(1)?.parse()?,
                    ipv6: row.get::<String>(2)?.parse()?,
                    auth_key: match row.get::<Option<Vec<u8>>>(3)? {
                        None => None,
                        Some(auth_key) => Some(auth_key.try_into().map_err(|v: Vec<u8>| EncryptedSessionError::InvalidAuthKeyLength(v.len()))?),
                    },
                })
            })
            .await?
            .into_iter()
            .map(|dc_option| (dc_option.id, dc_option))
            .collect();

        Ok(EncryptedSqliteSession { database: AsyncMutex::new(db), cache: Mutex::new(Cache { home_dc, dc_options }) })
    }
}

impl Session for EncryptedSqliteSession {
    type Error = EncryptedSessionError;

    fn home_dc_id(&self) -> Result<i32, EncryptedSessionError> {
        Ok(self.cache.lock().map_err(|_| EncryptedSessionError::Poisoned)?.home_dc)
    }

    fn set_home_dc_id(&self, dc_id: i32) -> BoxFuture<'_, Result<(), EncryptedSessionError>> {
        let ok = match self.cache.lock() {
            Err(_) => Err(EncryptedSessionError::Poisoned),
            Ok(mut x) => {
                x.home_dc = dc_id;
                Ok(())
            }
        };
        Box::pin(async move {
            ok?;

            let transaction = self.database.lock().await.begin_transaction().await?;
            transaction.execute("DELETE FROM dc_home", params![]).await?;
            let stmt = transaction.prepare("INSERT INTO dc_home VALUES (:dc_id)").await?;
            stmt.execute(named_params! {":dc_id": dc_id}).await?;
            transaction.commit().await?;
            Ok(())
        })
    }

    fn dc_option(&self, dc_id: i32) -> Result<Option<DcOption>, EncryptedSessionError> {
        Ok(self
            .cache
            .lock()
            .map_err(|_| EncryptedSessionError::Poisoned)?
            .dc_options
            .get(&dc_id)
            .cloned()
            .or_else(|| known_dc_options().into_iter().find(|dc_option| dc_option.id == dc_id)))
    }

    fn set_dc_option(&self, dc_option: &DcOption) -> BoxFuture<'_, Result<(), EncryptedSessionError>> {
        let ok = match self.cache.lock() {
            Err(_) => Err(EncryptedSessionError::Poisoned),
            Ok(mut x) => {
                x.dc_options.insert(dc_option.id, dc_option.clone());
                Ok(())
            }
        };

        let dc_option = dc_option.clone();
        Box::pin(async move {
            ok?;

            let db = self.database.lock().await;
            db.0.execute(
                "INSERT OR REPLACE INTO dc_option VALUES (:dc_id, :ipv4, :ipv6, :auth_key)",
                named_params! {
                    ":dc_id": dc_option.id,
                    ":ipv4": dc_option.ipv4.to_string(),
                    ":ipv6": dc_option.ipv6.to_string(),
                    ":auth_key": dc_option.auth_key.map(|k| k.to_vec()),
                },
            )
            .await?;
            Ok(())
        })
    }

    fn peer(&self, peer: PeerId) -> BoxFuture<'_, Result<Option<PeerInfo>, EncryptedSessionError>> {
        Box::pin(async move {
            let db = self.database.lock().await;
            let map_row = |row: libsql::Row| {
                let subtype = row.get::<Option<i64>>(2)?.map(|s| s as u8);
                Ok(match peer.kind() {
                    PeerKind::User => PeerInfo::User {
                        id: PeerId::user_unchecked(row.get::<i64>(0)?).bare_id_unchecked(),
                        auth: row.get::<Option<i64>>(1)?.map(PeerAuth::from_hash),
                        bot: subtype.map(|s| s & PeerSubtype::UserBot as u8 != 0),
                        is_self: subtype.map(|s| s & PeerSubtype::UserSelf as u8 != 0),
                    },
                    PeerKind::Chat => PeerInfo::Chat { id: peer.bare_id_unchecked() },
                    PeerKind::Channel => PeerInfo::Channel {
                        id: peer.bare_id_unchecked(),
                        auth: row.get::<Option<i64>>(1)?.map(PeerAuth::from_hash),
                        kind: subtype.and_then(|s| {
                            if (s & PeerSubtype::Gigagroup as u8) == PeerSubtype::Gigagroup as u8 {
                                Some(ChannelKind::Gigagroup)
                            } else if s & PeerSubtype::Broadcast as u8 != 0 {
                                Some(ChannelKind::Broadcast)
                            } else if s & PeerSubtype::Megagroup as u8 != 0 {
                                Some(ChannelKind::Megagroup)
                            } else {
                                None
                            }
                        }),
                    },
                })
            };

            Ok(if let Some(peer_id) = peer.bot_api_dialog_id() {
                db.fetch_one("SELECT * FROM peer_info WHERE peer_id = :peer_id LIMIT 1", named_params! {":peer_id": peer_id}, map_row).await?
            } else {
                db.fetch_one("SELECT * FROM peer_info WHERE subtype & :type LIMIT 1", named_params! {":type": PeerSubtype::UserSelf as i64}, map_row).await?
            })
        })
    }

    fn cache_peer(&self, peer: &PeerInfo) -> BoxFuture<'_, Result<(), EncryptedSessionError>> {
        let peer = peer.clone();
        Box::pin(async move {
            let peer = if let Some(mut existing_peer) = self.peer(peer.id()).await? {
                existing_peer.extend_info(&peer);
                existing_peer
            } else {
                peer
            };

            let db = self.database.lock().await;
            let stmt = db.0.prepare("INSERT OR REPLACE INTO peer_info VALUES (:peer_id, :hash, :subtype)").await?;
            let subtype = match peer {
                PeerInfo::User { bot, is_self, .. } => match (bot.unwrap_or_default(), is_self.unwrap_or_default()) {
                    (true, true) => Some(PeerSubtype::UserSelfBot),
                    (true, false) => Some(PeerSubtype::UserBot),
                    (false, true) => Some(PeerSubtype::UserSelf),
                    (false, false) => None,
                },
                PeerInfo::Chat { .. } => None,
                PeerInfo::Channel { kind, .. } => kind.map(|kind| match kind {
                    ChannelKind::Megagroup => PeerSubtype::Megagroup,
                    ChannelKind::Broadcast => PeerSubtype::Broadcast,
                    ChannelKind::Gigagroup => PeerSubtype::Gigagroup,
                }),
            };
            let mut params = vec![];
            let peer_id = peer.id().bot_api_dialog_id_unchecked();
            params.push((":peer_id".to_owned(), peer_id));
            let hash = peer.auth().unwrap_or_default().hash();
            if peer.auth().is_some() {
                params.push((":hash".to_owned(), hash));
            }
            let subtype = subtype.map(|s| s as i64);
            if let Some(subtype) = subtype {
                params.push((":subtype".to_owned(), subtype));
            }
            stmt.execute(params).await?;
            Ok(())
        })
    }

    fn updates_state(&self) -> BoxFuture<'_, Result<UpdatesState, EncryptedSessionError>> {
        Box::pin(async move {
            let db = self.database.lock().await;
            let mut state = db
                .fetch_one("SELECT * FROM update_state LIMIT 1", named_params![], |row| {
                    Ok(UpdatesState { pts: row.get(0)?, qts: row.get(1)?, date: row.get(2)?, seq: row.get(3)?, channels: Vec::new() })
                })
                .await?
                .unwrap_or_default();
            state.channels = db.fetch_all("SELECT * FROM channel_state", named_params![], |row| Ok(ChannelState { id: row.get(0)?, pts: row.get(1)? })).await?;
            Ok(state)
        })
    }

    fn set_update_state(&self, update: UpdateState) -> BoxFuture<'_, Result<(), EncryptedSessionError>> {
        Box::pin(async move {
            let db = self.database.lock().await;
            let transaction = db.begin_transaction().await?;

            match update {
                UpdateState::All(updates_state) => {
                    transaction.execute("DELETE FROM update_state", params![]).await?;
                    transaction
                        .execute(
                            "INSERT INTO update_state VALUES (:pts, :qts, :date, :seq)",
                            named_params! {
                                ":pts": updates_state.pts,
                                ":qts": updates_state.qts,
                                ":date": updates_state.date,
                                ":seq": updates_state.seq,
                            },
                        )
                        .await?;

                    transaction.execute("DELETE FROM channel_state", params![]).await?;
                    for channel in updates_state.channels {
                        transaction
                            .execute(
                                "INSERT INTO channel_state VALUES (:peer_id, :pts)",
                                named_params! {
                                    ":peer_id": channel.id,
                                    ":pts": channel.pts,
                                },
                            )
                            .await?;
                    }
                }
                UpdateState::Primary { pts, date, seq } => {
                    let previous = db.fetch_one("SELECT * FROM update_state LIMIT 1", named_params![], |_| Ok(())).await?;

                    if previous.is_some() {
                        transaction
                            .execute(
                                "UPDATE update_state SET pts = :pts, date = :date, seq = :seq",
                                named_params! {
                                    ":pts": pts,
                                    ":date": date,
                                    ":seq": seq,
                                },
                            )
                            .await?;
                    } else {
                        transaction
                            .execute(
                                "INSERT INTO update_state VALUES (:pts, 0, :date, :seq)",
                                named_params! {
                                    ":pts": pts,
                                    ":date": date,
                                    ":seq": seq,
                                },
                            )
                            .await?;
                    }
                }
                UpdateState::Secondary { qts } => {
                    let previous = db.fetch_one("SELECT * FROM update_state LIMIT 1", named_params![], |_| Ok(())).await?;

                    if previous.is_some() {
                        transaction.execute("UPDATE update_state SET qts = :qts", named_params! {":qts": qts}).await?;
                    } else {
                        transaction.execute("INSERT INTO update_state VALUES (0, :qts, 0, 0)", named_params! {":qts": qts}).await?;
                    }
                }
                UpdateState::Channel { id, pts } => {
                    transaction
                        .execute(
                            "INSERT OR REPLACE INTO channel_state VALUES (:peer_id, :pts)",
                            named_params! {
                                ":peer_id": id,
                                ":pts": pts,
                            },
                        )
                        .await?;
                }
            }

            transaction.commit().await?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr, SocketAddrV4, SocketAddrV6};

    use super::*;

    /// Port NGUYÊN VẸN test `exercise_sqlite_session` của
    /// `grammers-session-0.10.0/src/storages/sqlite.rs` — cùng kịch bản,
    /// khác đúng chỗ dùng `EncryptedSqliteSession::open(path, key)` thay
    /// `SqliteSession::open(path)`. Dùng file tạm thật (không `:memory:` —
    /// libsql yêu cầu file thật để test mã hoá có ý nghĩa) + xoá sau khi
    /// xong, KHÔNG đụng MTProto/tài khoản Telegram (an toàn để tự chạy).
    #[tokio::test]
    async fn exercise_encrypted_sqlite_session() {
        let path = std::env::temp_dir().join(format!("tsmc-encrypted-session-test-{}.sqlite3", std::process::id()));
        let _cleanup = CleanupOnDrop(path.clone());
        let key = Bytes::from_static(b"0123456789abcdef0123456789abcdef");

        let session = EncryptedSqliteSession::open(&path, key).await.unwrap();

        assert_eq!(session.home_dc_id().unwrap(), DEFAULT_DC);
        session.set_home_dc_id(DEFAULT_DC + 1).await.unwrap();
        assert_eq!(session.home_dc_id().unwrap(), DEFAULT_DC + 1);

        let known = known_dc_options();
        assert_eq!(session.dc_option(known[0].id).unwrap(), Some(known[0].clone()));
        let new_dc_option = DcOption {
            id: known.iter().map(|dc_option| dc_option.id).max().unwrap() + 1,
            ipv4: SocketAddrV4::new(Ipv4Addr::from_bits(0), 1),
            ipv6: SocketAddrV6::new(Ipv6Addr::from_bits(0), 1, 0, 0),
            auth_key: Some([1; 256]),
        };
        assert_eq!(session.dc_option(new_dc_option.id).unwrap(), None);
        session.set_dc_option(&new_dc_option).await.unwrap();
        assert_eq!(session.dc_option(new_dc_option.id).unwrap(), Some(new_dc_option));

        assert_eq!(session.peer(PeerId::self_user()).await.unwrap(), None);
        assert_eq!(session.peer(PeerId::user_unchecked(1)).await.unwrap(), None);
        let peer = PeerInfo::User { id: 1, auth: None, bot: Some(true), is_self: Some(true) };
        session.cache_peer(&peer).await.unwrap();
        assert_eq!(session.peer(PeerId::self_user()).await.unwrap(), Some(peer.clone()));
        assert_eq!(session.peer(PeerId::user_unchecked(1)).await.unwrap(), Some(peer));

        assert_eq!(session.peer(PeerId::channel_unchecked(1)).await.unwrap(), None);
        let peer = PeerInfo::Channel { id: 1, auth: Some(PeerAuth::from_hash(-1)), kind: Some(ChannelKind::Broadcast) };
        session.cache_peer(&peer).await.unwrap();
        assert_eq!(session.peer(PeerId::channel_unchecked(1)).await.unwrap(), Some(peer));

        assert_eq!(session.updates_state().await.unwrap(), UpdatesState::default());
        session
            .set_update_state(UpdateState::All(UpdatesState {
                pts: 1,
                qts: 2,
                date: 3,
                seq: 4,
                channels: vec![ChannelState { id: 5, pts: 6 }, ChannelState { id: 7, pts: 8 }],
            }))
            .await
            .unwrap();
        session.set_update_state(UpdateState::Primary { pts: 2, date: 4, seq: 5 }).await.unwrap();
        session.set_update_state(UpdateState::Secondary { qts: 3 }).await.unwrap();
        session.set_update_state(UpdateState::Channel { id: 7, pts: 9 }).await.unwrap();
        assert_eq!(
            session.updates_state().await.unwrap(),
            UpdatesState { pts: 2, qts: 3, date: 4, seq: 5, channels: vec![ChannelState { id: 5, pts: 6 }, ChannelState { id: 7, pts: 9 }] }
        );

        drop(session);

        // Xác nhận file KHÔNG phải SQLite plaintext — header chuẩn của một
        // file SQLite3 thường là chuỗi "SQLite format 3\0" (16 byte) NGAY ĐẦU
        // FILE; một file đã mã hoá thật KHÔNG được lộ chuỗi này ra ngoài.
        let raw_bytes = std::fs::read(&path).unwrap();
        assert!(raw_bytes.len() >= 16, "file quá nhỏ để kiểm header");
        assert_ne!(&raw_bytes[0..16], b"SQLite format 3\0", "file KHÔNG được lộ header SQLite plaintext — nếu thấy chuỗi này, module đã KHÔNG mã hoá gì cả");

        // Xác nhận file THẬT SỰ được mã hoá — mở lại bằng SAI key phải lỗi
        // (mở được bằng sai key = bug nghiêm trọng, coi như KHÔNG mã hoá gì).
        let wrong_key = Bytes::from_static(b"ffffffffffffffffffffffffffffffff");
        let reopened = EncryptedSqliteSession::open(&path, wrong_key).await;
        assert!(reopened.is_err(), "mở file mã hoá bằng SAI key phải lỗi, không được thành công");

        // Mở lại bằng ĐÚNG key phải đọc lại đúng dữ liệu đã ghi ở trên.
        let right_key = Bytes::from_static(b"0123456789abcdef0123456789abcdef");
        let reopened = EncryptedSqliteSession::open(&path, right_key).await.unwrap();
        assert_eq!(reopened.home_dc_id().unwrap(), DEFAULT_DC + 1);
    }

    struct CleanupOnDrop(std::path::PathBuf);
    impl Drop for CleanupOnDrop {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_file(self.0.with_extension("sqlite3-wal"));
            let _ = std::fs::remove_file(self.0.with_extension("sqlite3-shm"));
        }
    }
}
