// Download scheduler, DC pool, chunk cache — ADR-0006.
// Chạy trong Core Worker; apps/web KHÔNG được import package này trực tiếp (ADR-0012 §2).
export const LIB_NAME = '@tsmc/core-download' as const;
