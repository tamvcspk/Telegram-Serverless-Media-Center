import { Routes } from '@angular/router';

// Player (F4) — route THẬT đầu tiên trong app (mọi thứ khác vẫn nhúng phẳng
// trong Login, xem login.html). Lazy-load: player kéo theo Angular Material
// controls-adjacent code không cần thiết cho luồng đăng nhập/duyệt phim.
export const routes: Routes = [
  {
    path: 'player/:sourceId/:msgId',
    loadComponent: () => import('./player/player').then((m) => m.Player)
  }
];
