// 신한은행 확장 프로그램 직접 조작 드라이버 (Playwright)
// 사용: SHINHAN_ID=xxx SHINHAN_PW=yyy NODE_PATH=$(npm root -g) node driver.js
// 전제: 확장을 실제로 로드하고, popup.html을 탭으로 열어 확장의 popup.js 로직을 그대로 실행
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, 'shinhan-extractor');
const BANK_URL = 'https://bank.shinhan.com/rib/easy/index.jsp?cr=210000000000';

// .env(ID/PW)에서 로그인 계정 로드 — 파일 없거나 값 없으면 빈 값(더미 모드 유지)
let envConfig = {};
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) envConfig[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const USER = process.env.SHINHAN_ID || envConfig.ID || '';
const PASS = process.env.SHINHAN_PW || envConfig.PW || '';
const ENV_PATH = path.join(__dirname, '.env');

// .env ACCOUNTS 파싱: "계좌:비번,계좌:비번" (비밀번호 빈 값 허용 — 사용자가 나중에 채움)
const parseAccounts = (str) => (str || '')
  .split(',')
  .map(s => { const [no, pw] = s.trim().split(':'); return no ? { no: no.trim(), pw: (pw || '').trim() } : null; })
  .filter(Boolean);

// 계좌 select의 계좌 목록 기준으로 .env ACCOUNTS 동기화: 기존 비밀번호 보존, 없어진 계좌 제거, 새 계좌는 비밀번호 비움
function syncEnvAccounts(bankAccounts) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  let accountsLineIdx = -1;
  let existing = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*ACCOUNTS\s*=\s*(.*)\s*$/);
    if (m) { accountsLineIdx = i; existing = parseAccounts(m[1]); }
  }
  const pwMap = new Map(existing.map(a => [a.no, a.pw]));
  const newList = bankAccounts.map(no => ({ no, pw: pwMap.get(no) || '' }));
  const str = newList.map(a => (a.pw ? `${a.no}:${a.pw}` : `${a.no}:`)).join(',');
  if (accountsLineIdx >= 0) lines[accountsLineIdx] = 'ACCOUNTS=' + str;
  else lines.push('ACCOUNTS=' + str);
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
  const added = bankAccounts.filter(no => !pwMap.has(no));
  const removed = existing.filter(a => !bankAccounts.includes(a.no)).map(a => a.no);
  const emptyPw = newList.filter(a => !a.pw).map(a => a.no);
  LOG(`계좌 동기화: 추가 ${added.length}, 제거 ${removed.length}, 비번 미입력 ${emptyPw.length}`);
  if (added.length) LOG('  추가:', added.join(', '));
  if (removed.length) LOG('  제거:', removed.join(', '));
  if (emptyPw.length) LOG('  비번 채울 계좌:', emptyPw.join(', '));
  return newList;
}

let ACCOUNTS = parseAccounts(envConfig.ACCOUNTS);
if (!ACCOUNTS.length && envConfig.ACCOUNT_NO && envConfig.ACCOUNT_PW) {
  ACCOUNTS.push({ no: envConfig.ACCOUNT_NO, pw: envConfig.ACCOUNT_PW });
}
// 고정 프로필: 외부 앱 접근("Access other apps and services") Allow 권한 + 사용자가 수동 설치한 확장이 저장됨
const PROFILE = '/tmp/pw-banking-ext';

// 언팩 확장 ID = SHA-256(절대경로) 첫 16바이트, 각 바이트의 상/하위 니블을 a-p로 매핑 (32자)
function extensionIdFromPath(dir) {
  const hash = crypto.createHash('sha256').update(path.resolve(dir)).digest();
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 16; i++) id += alphabet[hash[i] >> 4] + alphabet[hash[i] & 0xf];
  return id;
}

const LOG = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 은행 페이지 좌상단에 현재 단계 오버레이 표시 (headless:false에서 사용자가 눈으로 확인)
async function overlay(bank, msg) {
  await bank.evaluate((m) => {
    let el = document.getElementById('driver-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'driver-overlay';
      el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:rgba(0,0,0,0.85);color:#0f0;font:bold 14px monospace;padding:10px 14px;border-radius:6px;pointer-events:none;max-width:70%;white-space:pre-wrap;box-shadow:0 0 8px rgba(0,0,0,0.5);';
      document.body.appendChild(el);
    }
    el.textContent = m;
  }, msg).catch(() => {});
}

// 아이디/암호가 보이는 로그인 화면으로 이동: 계좌조회 메뉴 클릭을 항상 실행 (로그인 폼은 숨김 처리되어 있을 수 있음)
const pageHasForm = () => {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
  };
  const root = document.getElementById('wq_uuid_338');
  const pw = document.getElementById('비밀번호');
  const id = document.getElementById('ibx_loginId');
  const btn = document.getElementById('btn_idLogin');
  if (!root || !isVisible(root)) return false;
  return isVisible(pw) && isVisible(id) && isVisible(btn);
};

// 3) 계좌조회 메뉴 클릭으로 로그인 화면 이동
async function clickLoginMenu(bank) {
  await dismissPopup(bank, 5000);
  const clickedTop = await bank.evaluate(() => {
    const el = document.getElementById('wq_uuid_147');
    if (!el) return false;
    el.click();
    return true;
  });
  LOG('상위 메뉴(계좌조회 span) 클릭:', clickedTop);
  await bank.waitForTimeout(1500);

  const clickedSub = await bank.evaluate(() => {
    const el = document.getElementById('wq_uuid_154');
    if (!el) return false;
    el.click();
    return true;
  });
  LOG('하위 메뉴(계좌조회 em) 클릭:', clickedSub);
  await dismissPopup(bank, 10000);
  return clickedTop && clickedSub;
}

// 5) 로그인 폼 hidden → show: 부모 체인에서 display:none / visibility:hidden 조상을 찾아 해제 (크기 0의 원인)
async function showLoginForm(bank) {
  const fixed = await bank.evaluate(() => {
    const root = document.getElementById('wq_uuid_338');
    if (!root) return [];
    const fixed = [];
    let node = root.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (st.display === 'none') { node.style.display = ''; fixed.push(node.id || node.tagName + ':display'); }
      if (st.visibility === 'hidden') { node.style.visibility = 'visible'; fixed.push(node.id || node.tagName + ':visibility'); }
      node = node.parentElement;
    }
    return fixed;
  });
  LOG('숨김 조상 해제:', JSON.stringify(fixed));
  return fixed.length > 0;
}

async function formStateDetail(bank) {
  return bank.evaluate(() => {
    const info = (id) => {
      const el = document.getElementById(id);
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return { exists: true, w: Math.round(r.width), h: Math.round(r.height), display: st.display, visibility: st.visibility };
    };
    return {
      wq_uuid_338: info('wq_uuid_338'),
      ibx_loginId: info('ibx_loginId'),
      비밀번호: info('비밀번호'),
      btn_idLogin: info('btn_idLogin'),
    };
  });
}

// W2UI 팝업(w2popup) 닫기 — X는 팝업 헤더 우상단. 3단계: 실제 X 요소(.w2window_close) → w2popup.close() → 우상단 모서리 클릭
async function dismissPopup(bank, waitMs = 8000) {
  const win = bank.locator('.w2popup_window').first();
  try { await win.waitFor({ state: 'visible', timeout: waitMs }); } catch { return true; }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await win.isVisible().catch(() => false))) return true;
    // 우선순위: 우상단 X(w2window_close) → 헤더 컨트롤 → 기타 close 클래스
    const xs = win.locator('.w2window_close, [id$="_close"], [title="창닫기"], [class*="header_control"], [class*="Close"], [class*="close"]');
    for (let i = 0; i < (await xs.count()); i++) {
      const el = xs.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await bank.waitForTimeout(800);
        if (!(await win.isVisible().catch(() => false))) return true;
      }
    }
    const closed = await bank.evaluate(() => {
      if (typeof w2popup !== 'undefined') { w2popup.close(); return true; }
      return false;
    }).catch(() => false);
    if (closed) {
      await bank.waitForTimeout(800);
      if (!(await win.isVisible().catch(() => false))) return true;
    }
    const box = await win.boundingBox();
    if (box) {
      await bank.mouse.click(box.x + box.width - 12, box.y + 12);
      await bank.waitForTimeout(800);
      if (!(await win.isVisible().catch(() => false))) return true;
    }
  }
  return !(await win.isVisible().catch(() => false));
}

// 거래내역 수집: viewRowCnt "전체 보기" 설정 후 거래일자 헤더 그리드에서 행 파싱
async function collectTransactions(bank) {
  await bank.evaluate(() => {
    const selects = [...document.querySelectorAll('select[id*="viewRowCnt"]')];
    for (const sel of selects) {
      for (const opt of sel.options) {
        if (opt.text.includes('전체')) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  }).catch(() => {});
  await bank.waitForTimeout(2000);

  return bank.evaluate(() => {
    const grids = [...document.querySelectorAll('.w2grid, [id$="grd_list"]')];
    for (const g of grids) {
      const ths = [...g.querySelectorAll('th')].map(t => t.textContent.trim());
      if (!ths.some(t => t.includes('거래일자'))) continue;
      const rows = [];
      g.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
        if (cells.length >= 5 && /^\d{4}/.test(cells[0])) rows.push(cells);
      });
      return { gridId: g.id, headers: ths, rows };
    }
    return null;
  }).catch(() => null);
}

// 연도/월별 CSV 저장 + 증분 병합 (동일 거래=거래일자+적요+출금+입금 키 → 최신 갱신, 새 거래 추가)
function saveTransactionsMonthly(accNo, rows) {
  const byMonth = {};
  for (const r of rows) {
    const m = (r[0] || '').match(/^(\d{4})\.(\d{2})/);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    (byMonth[key] = byMonth[key] || []).push(r);
  }
  for (const [ym, data] of Object.entries(byMonth)) {
    const [y, mo] = ym.split('-');
    const dir = path.join(__dirname, 'capture', y, mo);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `transactions_${accNo}.csv`);
    const merged = new Map();
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
      for (const line of lines) {
        const c = line.split(',');
        if (c.length >= 6) merged.set(`${c[0]}|${c[3]}|${c[4]}|${c[5]}`, c);
      }
    }
    for (const row of data) merged.set(`${row[0]}|${row[3]}|${row[4]}|${row[5]}`, row);
    const header = '거래일자,시간,거래일시,적요,출금(원),입금(원),내용,잔액(원),거래점';
    fs.writeFileSync(file, header + '\n' + [...merged.values()].map(r => r.join(',')).join('\n'));
    LOG(`CSV 저장: ${file} (${merged.size}행)`);
  }
  return Object.keys(byMonth).length;
}

// 파일저장 팝업(iframe CO00012RP) → 전체 열 체크 → 텍스트 저장 다운로드 (세미콜론 구분 서버 정리본)
async function downloadTransactionsTxt(bank) {
  await bank.evaluate(() => {
    const btn = document.getElementById('F01_wfr_grd_list_btngrp_div_btn_downFile') ||
      [...document.querySelectorAll('a')].find(a => a.textContent.trim() === '파일저장' && a.getBoundingClientRect().width > 0);
    if (btn) btn.click();
  }).catch(() => {});
  await bank.waitForTimeout(2000);

  const frame = bank.frames().find(f => f.url().includes('CO00012RP'));
  if (!frame) return { error: '파일저장 팝업 iframe 없음' };

  await frame.evaluate(() => {
    const all = document.getElementById('cbx_columnAll_input_0');
    if (all) {
      all.click();
      all.checked = true;
      all.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }).catch(() => {});
  await bank.waitForTimeout(500);

  try {
    const [download] = await Promise.all([
      bank.waitForEvent('download', { timeout: 15000 }),
      frame.evaluate(() => {
        const btn = document.getElementById('btn_saveTxt');
        if (btn) { btn.click(); return true; }
        return false;
      }),
    ]);
    const tmp = path.join('/tmp/opencode', download.suggestedFilename() || 'tx.txt');
    await download.saveAs(tmp);
    const content = fs.readFileSync(tmp, 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
    return { content };
  } catch (e) {
    return { error: '텍스트 저장 다운로드 실패: ' + e.message.slice(0, 80) };
  }
}

// 텍스트(세미콜론 구분) 파싱 → 연도/월별 CSV 저장 + 증분 병합 (동일 거래=거래일자+적요+출금+입금 키)
function saveTransactionsTxtMonthly(accNo, content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return 0;
  const header = lines[0];
  const byMonth = {};
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\d{4})-(\d{2})-\d{2}/);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    (byMonth[key] = byMonth[key] || []).push(line);
  }
  for (const [ym, rows] of Object.entries(byMonth)) {
    const [y, mo] = ym.split('-');
    const dir = path.join(__dirname, 'capture', y, mo);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `transactions_${accNo}.csv`);
    const merged = new Map();
    if (fs.existsSync(file)) {
      const prev = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
      for (const l of prev) {
        const c = l.split(';');
        if (c.length >= 6) merged.set(`${c[0]}|${c[2]}|${c[3]}|${c[4]}`, l);
      }
    }
    for (const row of rows) {
      const c = row.split(';');
      merged.set(`${c[0]}|${c[2]}|${c[3]}|${c[4]}`, row);
    }
    fs.writeFileSync(file, header + '\n' + [...merged.values()].join('\n'));
    LOG(`CSV 저장: ${file} (${merged.size}행)`);
  }
  return Object.keys(byMonth).length;
}

async function main() {
  // 기존 Chrome(사용자가 연 banking ext 프로필, 9222 CDP)을 제어.
  // Playwright가 프로필을 직접 열면 확장이 로드되지 않아(Chrome 137+ 차단) connectOverCDP로 전환
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // WebUSB/Serial/HID 계열 권한 미리 허용 (지원 안 하면 무시)
  try {
    await context.grantPermissions(['serial', 'usb', 'hid'], { origin: 'https://bank.shinhan.com' });
    LOG('device 권한 grant 시도 완료');
  } catch (e) {
    LOG('grantPermissions 미지원 (무시):', e.message.slice(0, 80));
  }

  // MV3 서비스워커가 있으면 로그 연결 (이 확장은 SW 없음 — 팝업이 chrome.scripting 직접 호출)
  const [sw] = context.serviceWorkers();
  if (sw) {
    sw.on('console', (m) => LOG('[SW]', m.type(), m.text()));
    sw.on('error', (e) => LOG('[SW error]', e.message));
  }

  const extId = extensionIdFromPath(EXT);
  LOG('extension id:', extId);
  LOG('로그인 계정:', USER ? `${USER} (env/.env 설정됨)` : '(없음 — 더미 모드)');

  // 1) 확장 팝업을 탭으로 (은행 탭이 나중에 활성 탭이 됨)
  const popup = await context.newPage();
  popup.on('console', (m) => LOG('[popup]', m.text()));

  // 프로필(/tmp/pw-banking-ext)에 사용자가 수동 설치한 확장이 자동 로드됨 — 확장 ID는 경로 기반
  const realExtId = extId;

  let popupOk = false;
  for (let i = 0; i < 4 && !popupOk; i++) {
    try {
      await popup.goto(`chrome-extension://${realExtId}/popup.html`, { timeout: 15000 });
      popupOk = true;
    } catch (e) {
      LOG(`popup 로드 재시도 ${i + 1}/4:`, e.message.slice(0, 80));
      await popup.waitForTimeout(1500);
    }
  }
  if (!popupOk) throw new Error('확장 popup 로드 실패');
  await popup.waitForSelector('#status');
  LOG('popup ready');

  // 2) 은행 탭 (활성 탭 유지 — 이후 popup 탭을 bringToFront 하면 확장이 엉뚱한 탭을 조작함)
  const bank = await context.newPage();

  // 네이티브 "Access other apps and services" 모달(WebUSB/Serial/HID) 우회 시도
  try {
    const cdp = await context.newCDPSession(bank);
    for (const p of ['serial', 'usb', 'hid']) {
      await cdp.send('Browser.setPermission', { permission: { name: p }, setting: 'granted', origin: 'https://bank.shinhan.com' }).catch(() => {});
    }
    LOG('CDP device 권한 설정 시도 완료');
  } catch (e) {
    LOG('CDP setPermission 실패 (무시):', e.message.slice(0, 80));
  }

  await overlay(bank, '로그인 페이지 이동 중...');
  await bank.goto(BANK_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  LOG('bank tab:', bank.url());

  const status = async () => (await popup.locator('#status').innerText().catch(() => ''));

  // 1) 로그인 페이지 이동 (tabs.update가 활성 탭=은행 탭을 이동)
  await overlay(bank, '1. 로그인 페이지 이동 중...');
  await popup.click('#goToLogin');
  await popup.waitForFunction(() => {
    const t = document.getElementById('status').innerText;
    return t.includes('페이지 로드 완료') || t.includes('보안 프로그램');
  }, { timeout: 5000 });
  LOG('--- goToLogin ---\n' + await status());

  // 2) 보안 프로그램 설치 팝업 닫기 (초기화 시작 시 뜨는 W2UI 팝업)
  await overlay(bank, '2. 보안 프로그램 설치 팝업 닫는 중...');
  await dismissPopup(bank);
  LOG('보안 안내 팝업 처리 완료');
  await dismissPopup(bank, 5000);
  LOG('지연 팝업 처리 완료');

  // 3) 계좌조회 메뉴 클릭으로 로그인 화면 이동
  await overlay(bank, '3. 계좌조회 메뉴 클릭으로 로그인 화면 이동 중...');
  await clickLoginMenu(bank);

  // 4) 로그인 폼 확인 — 5) 없으면 hidden → show 변환 (최대 3회)
  let formVisible = false;
  for (let attempt = 0; attempt < 3 && !formVisible; attempt++) {
    try {
      await bank.waitForFunction(pageHasForm, { timeout: 10000 });
      formVisible = true;
    } catch {
      if (attempt < 2) await clickLoginMenu(bank);
      const showed = await showLoginForm(bank);
      LOG(`폼 표시 시도 ${attempt + 1}/3: 숨김 해제 ${showed}`);
    }
  }
  if (!formVisible) {
    LOG('로그인 폼 표시 실패 — 중단. 상태:', JSON.stringify(await formStateDetail(bank)));
    await bank.screenshot({ path: path.join(__dirname, 'capture/driver_bank.png') });
    await popup.screenshot({ path: path.join(__dirname, 'capture/driver_popup.png') });
    return;
  }
  LOG('로그인 폼 확인: OK');
  
  // 6) 로그인 진행
  if (USER && PASS) {
    await popup.fill('#loginId', USER);
    await popup.fill('#loginPw', PASS);
  } else {
    // 더미 테스트 모드: 토글 ON → test123/test345 자동 입력
    const cb = popup.locator('#dummyTest');
    if (!(await cb.isChecked().catch(() => false))) await cb.check();
    await popup.waitForTimeout(300);
  }
  LOG('--- 로그인 폼 입력 ---\n' + await status());

  // 6-1) 아이디 입력
  await overlay(bank, '은행 로그인 아이디 입력 중...');
  const loginId = await popup.inputValue('#loginId');
  const fillRes = await popup.evaluate((id) => fillLoginId(id), loginId);
  LOG('은행 아이디 입력:', JSON.stringify(fillRes));

  // 6-2) TransKey 키패드 열기
  await overlay(bank, 'TransKey 키패드 여는 중...');
  await popup.click('#openKeypad');
  await popup.waitForFunction(() => document.getElementById('status').innerText.includes('tk 존재'), { timeout: 10000 });
  LOG('--- openKeypad ---\n' + await status());

  // TransKey 보안 프로그램 초기화 완료 대기: 로딩바 숨김 + 비밀번호 필드 존재 + transkeyUuid 채워짐
  await overlay(bank, '보안프로그램 초기화 + TransKey 준비 대기 중...');
  const secReady = await bank.waitForFunction(() => {
    const pb = document.getElementById('___processbar2');
    const pw = document.getElementById('비밀번호');
    const tu = document.getElementById('transkeyUuid');
    const uuidOk = tu && /^[0-9a-f]{32,64}$/i.test(tu.value || '');
    return pw !== null && (!pb || pb.style.display === 'none') && uuidOk;
  }, { timeout: 15000 }).then(() => true).catch(async () => {
    const cands = await bank.evaluate(() =>
      [...document.querySelectorAll('input')]
        .filter((i) => i.id || i.type === 'password' || i.placeholder)
        .slice(0, 30)
        .map((i) => ({ id: i.id, type: i.type, ph: i.placeholder })));
    LOG('보안 프로그램 초기화 대기 타임아웃. input 후보:', JSON.stringify(cands));
    return false;
  });
  if (!secReady) {
    LOG('보안 프로그램 미초기화 — doLogin 진행 중단');
    await bank.screenshot({ path: path.join(__dirname, 'capture/driver_bank.png') });
    await popup.screenshot({ path: path.join(__dirname, 'capture/driver_popup.png') });
    return;
  }
  LOG('보안 프로그램 초기화 완료 확인');

  // 3) 키패드 캡처 (스프라이트 + 45키 좌표)
  await overlay(bank, '키패드 캡처 중...');
  const kp = await popup.evaluate(() => getKeypadData());
  if (kp.error) {
    LOG('키패드 캡처 실패:', kp.error, JSON.stringify(kp.debug || {}));
  } else {
    LOG(`키패드 캡처: keys=${kp.keys.length}, imgB64=${kp.imgB64.length}B`);
    fs.writeFileSync(path.join(__dirname, 'capture/keypad.png'), Buffer.from(kp.imgB64, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'capture/keypad_keys.json'), JSON.stringify(kp.keys, null, 1));

    // 4) 로컬 VLLM(8083)로 키패드 구성 인식 (픽셀 ICON 감지 + 행 스트립)
    await overlay(bank, 'VLLM 분석 중... (ICON 감지 → 행 스트립 → 문자 인식)');
    const vres = await popup.evaluate(
      ({ imgB64, keys }) => ocrWithVisionStrips(imgB64, keys),
      { imgB64: kp.imgB64, keys: kp.keys });
    const charMap = vres.charMap || {};
    LOG(`VLLM charMap (${Object.keys(charMap).length}/36):`, JSON.stringify(charMap));
    LOG(`VLLM ICON idx: [${(vres.icons || []).join(', ')}]`);
    await overlay(bank, `VLLM 분석 완료: ${Object.keys(charMap).length}/36 문자 키 인식`);

    await popup.evaluate((cm) => { window.__savedCharMap = cm; }, charMap);
    await overlay(bank, '보안 설치 팝업 재확인 후 키패드 비밀번호 입력 + 로그인 제출 중...');
    await dismissPopup(bank, 3000);
    await popup.click('#doLogin');
    await bank.waitForTimeout(6000);
    LOG('--- doLogin ---\n' + await status());

    // ID로그인 안내 레이어(#out_alertLayer_message) 확인 → 닫기 클릭으로 계좌조회 화면 전환 (최대 14초 폴링)
    let popupHandled = false;
    for (let i = 0; i < 7 && !popupHandled; i++) {
      popupHandled = await bank.evaluate(() => {
        const msg = document.getElementById('out_alertLayer_message');
        if (msg && msg.innerText.includes('ID로그인')) {
          const closeBtn = document.querySelector('.layerClose') || document.getElementById('wq_uuid_499');
          if (closeBtn) { closeBtn.click(); return true; }
        }
        return false;
      }).catch(() => false);
      if (!popupHandled) await bank.waitForTimeout(2000);
    }
    LOG('ID로그인 안내 팝업 처리:', popupHandled);
    await bank.waitForTimeout(3000);

    // 로그인 후 은행 페이지 상태 검증: 보안 설치 팝업 잔존/로그인 진행 여부
    const postState = await bank.evaluate(() => {
      const popup = document.querySelector('.w2popup_window');
      const popupText = popup ? popup.innerText.replace(/\s+/g, ' ').slice(0, 200) : '';
      return {
        url: location.href.slice(0, 90),
        popupText,
        hasLoginForm: !!document.getElementById('wq_uuid_338'),
        pwValue: (document.getElementById('비밀번호') || {}).value || '',
      };
    });
    LOG('로그인 후 은행 상태:', JSON.stringify(postState));

    // 보안 프로그램 팝업이 없으면 파이프라인 성공. 폼이 사라졌으면 로그인 성공 — 로그인 후 바로 계좌조회 화면(이동 불필요)
    if (postState.popupText === '' && !postState.hasLoginForm) {
      LOG('로그인 성공 — 계좌조회 화면 진입 확인');
      await bank.waitForTimeout(2000);

      // extract: 계좌 select의 계좌 목록으로 .env ACCOUNTS 동기화
      const bankAccounts = await bank.evaluate(() => {
        const sel = document.getElementById('sbx_accno_input_0');
        if (!sel) return [];
        return [...sel.options].map(o => o.text.trim())
          .filter(t => t && t !== '선택하세요')
          .map(t => t.split('=')[0].trim());
      }).catch(() => []);
      if (bankAccounts.length) {
        ACCOUNTS = syncEnvAccounts(bankAccounts);
      } else {
        LOG('계좌 select를 찾지 못함 (sbx_accno_input_0)');
      }

      // 비밀번호가 하나도 없으면 종료
      const accsToQuery = ACCOUNTS.filter(a => a.pw);
      if (!accsToQuery.length) {
        LOG('.env 에 계좌 비밀번호를 등록해 주세요 (ACCOUNTS=계좌:비밀번호)');
        await bank.screenshot({ path: path.join(__dirname, 'capture/driver_bank.png') });
        await popup.screenshot({ path: path.join(__dirname, 'capture/driver_popup.png') });
        return;
      }

      // 조회기간 1년 선택 (w2radio 라벨 매칭)
      const periodSet = await bank.evaluate(() => {
        const radios = [...document.querySelectorAll('input.w2radio_input')];
        for (const r of radios) {
          const label = document.querySelector(`label[for="${r.id}"]`);
          if (label && label.textContent.trim().includes('1년')) {
            r.click();
            r.checked = true;
            r.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }).catch(() => false);
      LOG('조회기간 1년 선택:', periodSet);

      // 비밀번호 입력된 계좌별: 숫자 키패드 요소 스크린샷 → VLM 인식 → TransKey 입력 → 조회
      for (let i = 0; i < accsToQuery.length; i++) {
        const acc = accsToQuery[i];
        await overlay(bank, `계좌 조회 중... (${i + 1}/${accsToQuery.length}: ${acc.no})`);

        // 계좌비밀번호 숫자 키패드 열기 (요소 클릭 → TransKey가 키패드 표시)
        const openDbg = await bank.evaluate(() => {
          const el = document.getElementById('계좌비밀번호');
          if (!el) return { fieldMissing: true };
          el.click();
          if (typeof tk !== 'undefined' && tk.onKeyboard) tk.onKeyboard(el);
          return { fieldExists: true, tkNow: (typeof tk !== 'undefined' && tk.now) ? tk.now.id : null };
        }).catch(e => ({ evalErr: e.message.slice(0, 60) }));
        LOG(`계좌 ${acc.no} 키패드 열기:`, JSON.stringify(openDbg));

        // layout 안 키 앵커 좌표 수집 (화면 좌표) — 키패드가 열린 상태
        let numKeys = [];
        for (let t = 0; t < 5 && !numKeys.length; t++) {
          await bank.waitForTimeout(1000);
          numKeys = await bank.evaluate(() => {
            const layout = document.getElementById('계좌비밀번호_layout');
            if (!layout) return [];
            return [...layout.querySelectorAll('a[onclick*="tk.start"]')].map((a) => {
              const m = a.getAttribute('onclick').match(/tk\.start\(event,(\d+)\)/);
              if (!m) return null;
              const r = a.getBoundingClientRect();
              return { idx: parseInt(m[1], 10), x: r.x, y: r.y, w: r.width, h: r.height };
            }).filter(Boolean);
          }).catch(() => []);
        }
        LOG(`계좌 ${acc.no}: 숫자 키 ${numKeys.length}개 감지`);
        if (!numKeys.length) { LOG('숫자 키패드 요소 없음 — 건너뜀'); continue; }

        // 숫자 키패드 캡처 저장 (디버깅/연구용)
        const kpShot = await bank.locator('#계좌비밀번호_mainDiv').screenshot({ timeout: 5000 }).catch(() => null);
        if (kpShot) {
          fs.writeFileSync(path.join(__dirname, 'capture/numpad.png'), kpShot);
          LOG('숫자 키패드 저장: capture/numpad.png');
        }
        fs.writeFileSync(path.join(__dirname, 'capture/numpad_keys.json'), JSON.stringify(numKeys, null, 1));
        LOG('숫자 키패드 keys 저장: capture/numpad_keys.json');

        // 각 키 영역 clip 스크린샷 → VLM으로 숫자 인식 (기능키/아이콘은 숫자 아님 → charMap 제외)
        const numericCharMap = {};
        for (const k of numKeys) {
          const shot = await bank.screenshot({ clip: { x: k.x, y: k.y, width: k.w, height: k.h } }).catch(() => null);
          if (!shot) continue;
          const b64 = shot.toString('base64');
          const ch = await popup.evaluate(async (imgB64) => {
            const resp = await fetch('http://127.0.0.1:8083/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'vision',
                messages: [{ role: 'user', content: [
                  { type: 'image_url', image_url: { url: 'data:image/png;base64,' + imgB64 } },
                  { type: 'text', text: 'Output exactly one character shown in this image: a digit (0-9) or a symbol like backspace/enter. Output nothing else.' }
                ]}],
                max_tokens: 10,
                temperature: 0.1,
                min_p: 0.15,
                repetition_penalty: 1.05,
              }),
            });
            const data = await resp.json();
            return (data.choices?.[0]?.message?.content || '').match(/[0-9]/)?.[0] || null;
          }, b64).catch(() => null);
          if (ch && numericCharMap[ch] === undefined) numericCharMap[ch] = k.idx;
        }
        LOG(`계좌 ${acc.no} 숫자 charMap (${Object.keys(numericCharMap).length}/10):`, JSON.stringify(numericCharMap));

        // 계좌 select에서 선택 + 숫자 charMap으로 비밀번호 입력 + 조회 클릭
        const res = await popup.evaluate(
          ({ accNo, accPw, cm }) => accountInquiryWithVision(accNo, accPw, cm),
          { accNo: acc.no, accPw: acc.pw, cm: numericCharMap });
        LOG(`계좌 조회 ${i + 1}/${accsToQuery.length} (${acc.no}):`, JSON.stringify(res));
        await bank.waitForTimeout(5000);

        // 3개월 조회가 성공하면: 시작 날짜를 1년 전으로 수정 후 재조회 (1년 기간 최종)
        if (res && res.success) {
          const frSet = await bank.evaluate(() => {
            const fr = document.getElementById('wfr_searchCalendar_ica_fr_input');
            if (!fr) return false;
            const pad = (n) => String(n).padStart(2, '0');
            const now = new Date();
            const frD = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
            fr.value = `${frD.getFullYear()}.${pad(frD.getMonth() + 1)}.${pad(frD.getDate())}`;
            fr.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }).catch(() => false);
          LOG('시작 날짜 1년 전 설정:', frSet);
          await bank.waitForTimeout(1000);
          const reClick = await bank.evaluate(() => {
            const btn = document.getElementById('btn_조회');
            if (btn) { btn.click(); return true; }
            return false;
          }).catch(() => false);
          LOG('재조회 클릭:', reClick);
          await bank.waitForTimeout(5000);
        }

        // 거래내역 저장: 파일저장→텍스트 저장(서버 정리본) 우선, 실패 시 w2grid DOM 파싱 fallback
        const txt = await downloadTransactionsTxt(bank);
        if (txt && txt.content) {
          const monthCount = saveTransactionsTxtMonthly(acc.no.replace(/-/g, ''), txt.content);
          LOG(`거래내역 텍스트 저장: ${monthCount}개월치`);
        } else {
          LOG('텍스트 저장 실패 — w2grid 파싱 fallback:', txt ? txt.error : 'unknown');
          const tx = await collectTransactions(bank);
          if (tx && tx.rows.length) {
            const monthCount = saveTransactionsMonthly(acc.no.replace(/-/g, ''), tx.rows);
            LOG(`거래내역 ${tx.rows.length}건, ${monthCount}개월치 저장 (${tx.gridId})`);
          } else {
            LOG(`거래내역 없음 (${acc.no}) — 조회 결과 없음/해지 계좌일 수 있음`);
          }
        }
        LOG('--- 계좌 조회 후 상태 ---\n' + await status());
      }
    } else if (postState.popupText === '') {
      LOG('파이프라인 성공 (로그인 폼 잔존 — 안내 팝업 처리 후 화면 전환 확인)');
    }
  }

  await bank.screenshot({ path: path.join(__dirname, 'capture/driver_bank.png') });
  await popup.screenshot({ path: path.join(__dirname, 'capture/driver_popup.png') });
  LOG('완료. 유지 중 (Ctrl+C로 종료)');
  await new Promise(() => {});
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
