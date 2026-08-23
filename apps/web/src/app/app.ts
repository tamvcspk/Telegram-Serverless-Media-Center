import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { createCoreWorkerClient } from '@tsmc/worker-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  constructor() {
    // Proof-of-wiring tạm thời: xác nhận Core Worker + Comlink + esbuild
    // bundling hoạt động đúng trong @angular/build:application trước khi
    // slice Auth thay bằng RPC thật (ADR-0003/0004).
    void createCoreWorkerClient()
      .ping()
      .then((result) => console.log('[core-worker]', result));
  }
}
