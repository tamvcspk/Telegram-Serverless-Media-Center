// SPIKE-03: bản song song dùng teleproto (fork đang được bảo trì của GramJS)
// để so sánh — xem docs/spikes/README.md#spike-03.
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

globalThis.__spike03 = { TelegramClient, StringSession };
