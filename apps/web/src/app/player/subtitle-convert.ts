// Convert phụ đề SRT → WebVTT — `<video><track>` gốc của trình duyệt CHỈ nhận
// WebVTT (roadmap.md "Player: ... convert SRT→VTT"), trong khi phần lớn phụ
// đề cộng đồng trên Telegram là `.srt`. Chỉ đổi phần cú pháp bắt buộc (khai
// báo `WEBVTT` + dấu phẩy→chấm trong timestamp) — dòng số thứ tự cue của SRT
// vẫn là cue identifier hợp lệ trong WebVTT, không cần bóc.
const SRT_TIMECODE_LINE = /^(\d{2}:\d{2}:\d{2}),(\d{3})(\s*-->\s*)(\d{2}:\d{2}:\d{2}),(\d{3})(.*)$/;
/** BOM (`String.fromCharCode(0xfeff)` thay vì literal ký tự — literal BOM trong source bị eslint `no-irregular-whitespace` chặn). */
const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

export function looksLikeVtt(text: string): boolean {
  return /^WEBVTT/.test(stripBom(text).trimStart());
}

export function srtToVtt(text: string): string {
  const body = stripBom(text)
    .split(/\r\n|\n|\r/)
    .map((line) => {
      const match = SRT_TIMECODE_LINE.exec(line);
      return match ? `${match[1]}.${match[2]}${match[3]}${match[4]}.${match[5]}${match[6]}` : line;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Chuẩn hoá bytes phụ đề tải về (SRT hoặc VTT, chưa rõ trước khi đọc nội dung) thành text WebVTT sẵn sàng gắn `<track>`. */
export function toVttText(raw: ArrayBuffer): string {
  const text = new TextDecoder('utf-8').decode(raw);
  return looksLikeVtt(text) ? text : srtToVtt(text);
}
