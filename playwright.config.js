// 신한은행 확장 조작 Playwright 설정
//
// 전제 조건: Chrome을 banking ext 프로필 + CDP 9222로 미리 실행해 둘 것
//   /usr/bin/google-chrome-stable --user-data-dir=/tmp/pw-banking-ext \
//     --remote-debugging-port=9222 --no-first-run about:blank &
//
// 확장은 chrome://extensions 개발자 모드로 수동 1회 설치 필요
// (Chrome 137+ --load-extension 차단으로 connectOverCDP 방식 사용)
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 300000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
