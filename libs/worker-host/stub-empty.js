// Stub rỗng cho các module Node không có ý nghĩa trong trình duyệt (fs, net, tls).
// Nếu build vẫn thành công với stub này, nghĩa là nhánh code browser của
// GramJS không thực sự gọi tới các API đó lúc runtime — chỉ bị kéo vào vì
// bundler phân giải tĩnh toàn bộ cây import. Cấu hình đã kiểm chứng thật ở
// SPIKE-03 (236 KB brotli, ~110ms init trên Chrome thật) — copy nguyên xi.
export default {};
