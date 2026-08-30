// Prompt terminal tối giản — cố tình KHÔNG thêm thư viện (inquirer/prompts)
// cho một CLI chỉ có 3 lệnh (đúng tinh thần "giữ dependency tối thiểu" của
// repo, cùng lý do ghim `telegram@2.26.22` thay vì để version range). Dùng
// thẳng `node:readline/promises` — có sẵn từ Node 17+, repo yêu cầu >=22.
import { createInterface } from 'node:readline/promises';

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Input ẩn (mật khẩu 2FA) — readline không hỗ trợ mask sẵn, phải tự tắt echo
 * bằng raw mode + tự vẽ lại dòng nhập bằng `*`. Chỉ áp dụng khi stdin là TTY
 * thật (không phải pipe/redirect) — fallback về `prompt()` thường nếu không,
 * để không treo CLI khi chạy trong môi trường không có TTY (vd CI).
 */
export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return prompt(question);
  }

  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = '';

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === '') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '') {
          // Ctrl+C — thoát ngay, không nuốt lỗi (biên nhập tay của admin).
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

export async function confirm(question: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await prompt(`${question} [${hint}] `)).toLowerCase();
  if (answer.length === 0) {
    return defaultValue;
  }
  return answer === 'y' || answer === 'yes';
}
