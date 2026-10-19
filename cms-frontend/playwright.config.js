import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // PWA 的 Service Worker 会在浏览器内部发起请求，绕过 page.route()。
  // 回归测试依赖 API mock，因此统一阻止 Service Worker，PWA 本身由独立验收覆盖。
  use: { baseURL: 'http://127.0.0.1:5199', browserName: 'chromium', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 5199', url: 'http://127.0.0.1:5199', reuseExistingServer: false },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});
