import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // App không còn tự vẽ tiêu đề/nội dung nào — chỉ là <router-outlet />
  // (skeleton routing, xem app.routes.ts). Tiêu đề "TSMC" giờ sống trong
  // Login (route 'login'), không test được ở đây vì TestBed này không cấu
  // hình router thật.
});
