import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import * as Comlink from 'comlink';

// Regression test cho bug thật đã gặp trên cả Windows lẫn iOS: bọc TỪNG hàm
// callback rời bằng Comlink.proxy() rồi nhét vào một object thường KHÔNG
// hoạt động — Comlink chỉ kiểm tra marker proxy ở đối số cấp cao nhất, nên
// object chứa (không có marker) rơi về structured-clone mặc định của
// postMessage và vỡ ngay khi gặp function bên trong. Phải bọc CẢ object
// bằng một Comlink.proxy() duy nhất (xem apps/web/src/app/login/login.ts).
// Dùng MessageChannel thật của Node (spec-compliant với Web MessagePort)
// để bài test này đi qua đúng đường postMessage thật, không phải mock.
interface RemoteApi {
  callBack(callbacks: { greet(name: string): Promise<string> }): Promise<string>;
}

describe('Comlink: truyền callback qua biên Worker', () => {
  it('bọc CẢ object callbacks bằng một Comlink.proxy() — round-trip đúng, không lỗi clone', async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    Comlink.expose(
      {
        async callBack(callbacks: { greet(name: string): Promise<string> }) {
          return callbacks.greet('TSMC');
        }
      },
      port1 as unknown as Comlink.Endpoint
    );
    const remote = Comlink.wrap<RemoteApi>(port2 as unknown as Comlink.Endpoint);

    const result = await remote.callBack(
      Comlink.proxy({
        greet: async (name: string) => `Xin chào, ${name}!`
      })
    );

    expect(result).toBe('Xin chào, TSMC!');

    port1.close();
    port2.close();
  });

  it('bọc TỪNG hàm rời rồi nhét vào object thường — tái hiện đúng lỗi đã gặp thật', async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();

    Comlink.expose(
      {
        async callBack(callbacks: { greet(name: string): Promise<string> }) {
          return callbacks.greet('TSMC');
        }
      },
      port1 as unknown as Comlink.Endpoint
    );
    const remote = Comlink.wrap<RemoteApi>(port2 as unknown as Comlink.Endpoint);

    await expect(
      remote.callBack({
        // Sai: proxy từng hàm rồi nhét vào object KHÔNG được proxy.
        greet: Comlink.proxy(async (name: string) => `Xin chào, ${name}!`) as unknown as (
          name: string
        ) => Promise<string>
      })
    ).rejects.toThrow();

    port1.close();
    port2.close();
  });
});
