//! Implementation `IngestRpc` (`ingest-rpc-trait`) bằng `grammers-client`
//! 0.10.0 — xem `docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md`.

pub mod rpc;
pub mod session;

pub use rpc::GrammersIngestRpc;
pub use session::{Connected, connect, flood_wait_seconds};
