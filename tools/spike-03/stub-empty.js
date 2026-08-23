// Stub rỗng cho các module Node không có ý nghĩa trong trình duyệt (fs, net, tls).
// Nếu build vẫn thành công với stub này, nghĩa là nhánh code browser của
// thư viện không thực sự gọi tới các API đó lúc runtime — chỉ bị kéo vào
// vì bundler phân giải tĩnh toàn bộ cây import.
export default {};
