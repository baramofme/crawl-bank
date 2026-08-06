// 신한은행 확장 조작 테스트 — connectOverCDP로 기존 Chrome(9222) 제어
// 실행: npx playwright test
const { test, expect, chromium } = require('@playwright/test');

const EXT_ID = 'efnhhmncoflmkccmcdnodpeekalfbbbe';
const BANK_URL = 'https://bank.shinhan.com/rib/easy/index.jsp?cr=210000000000';

test.beforeAll(async () => {
  // Chrome이 9222 CDP로 떠 있는지 확인 (없으면 명시적 실패)
  try {
    await fetch('http://127.0.0.1:9222/json/version');
  } catch {
    throw new Error('Chrome CDP 9222 미실행 — 다음 명령으로 Chrome을 먼저 실행하세요:\n' +
      '/usr/bin/google-chrome-stable --user-data-dir=/tmp/pw-banking-ext --remote-debugging-port=9222 --no-first-run about:blank &');
  }
});

test('확장 popup 로드 및 은행 페이지 접근', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];

  // 1) 확장 popup 로드 확인
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await expect(popup.locator('#status')).toBeVisible({ timeout: 10000 });
  console.log('확장 popup 로드 OK');

  // 2) 은행 페이지 접근
  const bank = await context.newPage();
  await bank.goto(BANK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(bank.locator('body')).toBeVisible();
  console.log('은행 페이지 접근 OK:', bank.url().slice(0, 60));

  await browser.close();
});

test('확장 popup에서 로그인 페이지 이동 버튼 동작', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await popup.waitForSelector('#goToLogin');

  // 버튼 존재 및 클릭 가능 상태 확인 (실제 이동은 보안 프로그램/로그인 상태 의존)
  await expect(popup.locator('#goToLogin')).toBeEnabled();
  await expect(popup.locator('#openKeypad')).toBeEnabled();
  await expect(popup.locator('#doLogin')).toBeEnabled();
  console.log('확장 컨트롤 버튼 3종 확인 OK');

  await browser.close();
});
