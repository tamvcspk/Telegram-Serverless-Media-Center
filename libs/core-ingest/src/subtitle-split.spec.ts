import { describe, expect, it } from 'vitest';
import { parseSubtitleCues, rebaseSubtitle } from './subtitle-split';

const SRT = `1
00:00:01,000 --> 00:00:03,000
Một

2
00:00:09,000 --> 00:00:12,000
Vắt ngang điểm cắt

3
00:00:15,500 --> 00:00:17,000
Ở phần sau
`;

describe('rebaseSubtitle', () => {
  it('phần đầu: giữ cue trong cửa sổ, cắt ngắn cue vắt ngang tại biên', () => {
    expect(rebaseSubtitle(SRT, 0, 10)).toBe('1\n00:00:01,000 --> 00:00:03,000\nMột\n\n2\n00:00:09,000 --> 00:00:10,000\nVắt ngang điểm cắt\n');
  });

  it('phần sau: cue vắt ngang được nhân đôi, dịch về 0 tại đầu phần, đánh số lại từ 1', () => {
    expect(rebaseSubtitle(SRT, 10, 20)).toBe('1\n00:00:00,000 --> 00:00:02,000\nVắt ngang điểm cắt\n\n2\n00:00:05,500 --> 00:00:07,000\nỞ phần sau\n');
  });

  it('không còn cue nào → chuỗi rỗng', () => {
    expect(rebaseSubtitle(SRT, 100, 200)).toBe('');
  });

  it('nhận WebVTT (header, dấu chấm, giờ tuỳ chọn, cue settings) và xuất SRT', () => {
    const vtt = 'WEBVTT\n\nNOTE bỏ qua\n\n01:05.250 --> 01:07.000 align:start\nXin chào\n';
    expect(rebaseSubtitle(vtt, 60, 120)).toBe('1\n00:00:05,250 --> 00:00:07,000\nXin chào\n');
  });

  it('chịu CRLF và BOM', () => {
    const crlf = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n';
    expect(parseSubtitleCues(crlf)).toEqual([{ startSec: 1, endSec: 2, text: 'A' }]);
  });

  it('bỏ cue hỏng (kết thúc ≤ bắt đầu, thân rỗng) thay vì ném lỗi', () => {
    expect(parseSubtitleCues('1\n00:00:05,000 --> 00:00:04,000\nX\n\n2\n00:00:01,000 --> 00:00:02,000\n')).toEqual([]);
  });

  it('cue nhiều dòng giữ nguyên xuống dòng', () => {
    expect(rebaseSubtitle('1\n00:00:01,000 --> 00:00:02,000\nDòng 1\nDòng 2\n', 0, 5)).toContain('Dòng 1\nDòng 2');
  });
});
