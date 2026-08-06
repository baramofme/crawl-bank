// 신한은행 간편조회 자동화 드라이버 — Playwright 단독 버전 (크롬 확장 불필요)
// 사용: NODE_PATH=$(npm root -g) node driver-noext.js
// 전제: Chrome을 banking ext 프로필 + CDP 9222로 실행 (확장 설치 불필요)
//   /usr/bin/google-chrome-stable --user-data-dir=/tmp/pw-banking-ext \
//     --remote-debugging-port=9222 --no-first-run about:blank &
// VLM 서버(8083) + .env(ID/PW/ACCOUNTS) 필요
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BANK_URL = 'https://bank.shinhan.com/rib/easy/index.jsp?cr=210000000000';

// .env 로드
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

const LOG = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const parseAccounts = (str) => (str || '')
  .split(',')
  .map(s => { const [no, pw] = s.trim().split(':'); return no ? { no: no.trim(), pw: (pw || '').trim() } : null; })
  .filter(Boolean);

let ACCOUNTS = parseAccounts(envConfig.ACCOUNTS);

async function overlay(bank, msg) {
  await bank.evaluate((m) => {
    let el = document.getElementById('driver-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'driver-overlay';
      el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:rgba(0,0,0,0.85);color:#0f0;font:bold 14px monospace;padding:10px 14px;border-radius:6px;pointer-events:none;max-width:70%;white-space:pre-wrap;';
      document.body.appendChild(el);
    }
    el.textContent = m;
  }, msg).catch(() => {});
}

// 로그인 폼 visible 판정
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

async function clickLoginMenu(bank) {
  await dismissPopup(bank, 5000);
  const clickedTop = await bank.evaluate(() => {
    const el = document.getElementById('wq_uuid_147');
    if (!el) return false;
    el.click();
    return true;
  });
  LOG('상위 메뉴 클릭:', clickedTop);
  await bank.waitForTimeout(1500);
  const clickedSub = await bank.evaluate(() => {
    const el = document.getElementById('wq_uuid_154');
    if (!el) return false;
    el.click();
    return true;
  });
  LOG('하위 메뉴 클릭:', clickedSub);
  await dismissPopup(bank, 10000);
  return clickedTop && clickedSub;
}

async function showLoginForm(bank) {
  return bank.evaluate(() => {
    const root = document.getElementById('wq_uuid_338');
    if (!root) return [];
    const fixed = [];
    let node = root.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (st.display === 'none') { node.style.display = ''; fixed.push((node.id || node.tagName) + ':display'); }
      if (st.visibility === 'hidden') { node.style.visibility = 'visible'; fixed.push((node.id || node.tagName) + ':visibility'); }
      node = node.parentElement;
    }
    return fixed;
  }).catch(() => []);
}

async function dismissPopup(bank, waitMs = 8000) {
  const win = bank.locator('.w2popup_window').first();
  try { await win.waitFor({ state: 'visible', timeout: waitMs }); } catch { return true; }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await win.isVisible().catch(() => false))) return true;
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

// VLM 개별 키 인식 (Node에서 직접 호출 — CORS 없음)
async function vlmReadKey(b64, prompt) {
  try {
    const resp = await fetch('http://127.0.0.1:8083/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vision',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
          { type: 'text', text: prompt },
        ]}],
        max_tokens: 10,
        temperature: 0.1,
        min_p: 0.15,
        repetition_penalty: 1.05,
      }),
    });
    const data = await resp.json();
    const m = (data.choices?.[0]?.message?.content || '').match(/["']?([a-zA-Z0-9])["']?/);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

// 로그인 키패드: 열기 + 45키 좌표 + 스프라이트 캡처 (evaluate — 확장 불필요)
async function captureLoginKeypad(bank) {
  const data = await bank.evaluate(async () => {
    const pw = document.getElementById('비밀번호');
    if (!pw) return { error: '비밀번호 필드 없음' };
    if (typeof tk === 'undefined') return { error: 'tk 객체 없음' };
    tk.onKeyboard(pw);
    const lower = document.getElementById('비밀번호_layoutLower');
    if (!lower) return { error: 'layoutLower 없음' };
    let bg = '';
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      bg = getComputedStyle(lower).backgroundImage;
      if (bg && bg !== 'none') break;
    }
    if (!bg || bg === 'none') return { error: '키패드 이미지 로드 안 됨' };
    const url = bg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '').trim();
    const keys = [];
    for (let i = 0; i < 45; i++) {
      const k = tk.getKeyByIndex(i, 'qwerty');
      keys.push({ idx: i, x: k.xpoints[0], y: k.ypoints[0], w: k.xpoints[1] - k.xpoints[0], h: k.ypoints[2] - k.ypoints[0] });
    }
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { imgB64: btoa(bin), keys };
  }).catch(e => ({ error: e.message.slice(0, 80) }));
  if (data.error) { LOG('키패드 캡처 실패:', data.error); return null; }
  return data;
}

// ICON 감지 + 문자 키 개별 4x 크롭 → base64 배열 (evaluate)
async function cropCharKeys(bank, imgB64, keys) {
  return bank.evaluate(async ({ imgB64, keys }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + imgB64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const icons = [];
    for (const k of keys) {
      let colored = 0, total = 0;
      for (let y = k.y; y < k.y + k.h; y++) {
        for (let x = k.x; x < k.x + k.w; x++) {
          const i = (y * img.width + x) * 4;
          if (Math.abs(px[i] - px[i + 2]) > 30 || Math.abs(px[i + 1] - px[i + 2]) > 30) colored++;
          total++;
        }
      }
      if (colored / total * 100 > 5) icons.push(k.idx);
    }
    const iconSet = new Set(icons);
    const crops = [];
    for (const k of keys) {
      if (iconSet.has(k.idx)) continue;
      const c = document.createElement('canvas');
      c.width = k.w * 4; c.height = k.h * 4;
      const cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(img, k.x, k.y, k.w, k.h, 0, 0, k.w * 4, k.h * 4);
      crops.push({ idx: k.idx, b64: c.toDataURL('image/png').split(',')[1] });
    }
    return { icons, crops };
  }, { imgB64, keys }).catch(() => ({ icons: [], crops: [] }));
}

// VLM 병렬 인식 → charMap (배치 4)
async function recognizeCharMap(crops, prompt) {
  const charMap = {};
  for (let i = 0; i < crops.length; i += 4) {
    const batch = crops.slice(i, i + 4);
    const results = await Promise.all(batch.map(c => vlmReadKey(c.b64, prompt)));
    batch.forEach((c, j) => {
      const ch = results[j];
      if (ch && /^[a-z0-9]$/.test(ch) && charMap[ch] === undefined) charMap[ch] = c.idx;
    });
  }
  return charMap;
}

// TransKey로 비밀번호 입력 (evaluate — tk.start 직접 호출, 대문자/특수문자는 Shift 처리)
const TK_SPECIAL_SHIFT = { '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-','+':'=' };
async function typePassword(bank, fieldId, value, charMap) {
  return bank.evaluate(async ({ fieldId, value, charMap, shiftMap }) => {
    const input = document.getElementById(fieldId);
    if (!input) return { error: '필드 없음: ' + fieldId };
    if (!tk) return { error: 'tk 없음' };
    if (!tk.now || tk.now.id !== fieldId) tk.onKeyboard(input);
    await new Promise(r => setTimeout(r, 400));
    clickDummy = true;
    tk.now.clear();
    const tkPress = (index) => tk.start({ offsetX: 1, offsetY: 1 }, index);
    const tkShift = () => tkPress(55);
    for (const ch of value) {
      const lower = ch.toLowerCase();
      if (shiftMap[ch] !== undefined) {
        const baseIdx = charMap[shiftMap[ch]];
        if (baseIdx === undefined) return { error: '특수문자 베이스 키 미인식: ' + ch };
        tkShift(); tkPress(baseIdx); tkShift();
      } else if (charMap[lower] !== undefined) {
        if (ch !== lower) { tkShift(); tkPress(charMap[lower]); tkShift(); }
        else tkPress(charMap[lower]);
      } else {
        return { error: '키패드에 없는 문자: ' + ch };
      }
    }
    return { success: true };
  }, { fieldId, value, charMap, shiftMap: TK_SPECIAL_SHIFT });
}

// 계좌 select 동기화 (.env ACCOUNTS 갱신)
function syncEnvAccounts(bankAccounts) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  let idx = -1, existing = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*ACCOUNTS\s*=\s*(.*)\s*$/);
    if (m) { idx = i; existing = parseAccounts(m[1]); }
  }
  const pwMap = new Map(existing.map(a => [a.no, a.pw]));
  const newList = bankAccounts.map(no => ({ no, pw: pwMap.get(no) || '' }));
  const str = newList.map(a => (a.pw ? `${a.no}:${a.pw}` : `${a.no}:`)).join(',');
  if (idx >= 0) lines[idx] = 'ACCOUNTS=' + str;
  else lines.push('ACCOUNTS=' + str);
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
  const added = bankAccounts.filter(no => !pwMap.has(no));
  const removed = existing.filter(a => !bankAccounts.includes(a.no)).map(a => a.no);
  LOG(`계좌 동기화: 추가 ${added.length}, 제거 ${removed.length}`);
  return newList;
}

// 파일저장 → 텍스트 저장 다운로드 (서버 정리본)
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
    if (all) { all.click(); all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); }
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
    return { error: '텍스트 저장 실패: ' + e.message.slice(0, 80) };
  }
}

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
  if (!USER || !PASS) {
    console.error('.env에 ID/PW가 없습니다 (cp .env.example .env 후 설정)');
    process.exit(1);
  }
  LOG(`로그인 계정: ${USER}`);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const bank = await context.newPage();

  // 1) 로그인 페이지 이동 + 폼 표시
  await overlay(bank, '로그인 페이지 이동 중...');
  await bank.goto(BANK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await bank.waitForTimeout(3000);
  await clickLoginMenu(bank);

  let formVisible = false;
  for (let attempt = 0; attempt < 3 && !formVisible; attempt++) {
    try {
      await bank.waitForFunction(pageHasForm, { timeout: 15000 });
      formVisible = true;
    } catch {
      if (attempt < 2) await clickLoginMenu(bank);
      const fixed = await showLoginForm(bank);
      LOG(`폼 표시 시도 ${attempt + 1}/3: 숨김 해제 ${fixed.length}`);
    }
  }
  if (!formVisible) { LOG('로그인 폼 표시 실패 — 중단'); return; }
  LOG('로그인 폼 확인: OK');

  // 2) ID 입력
  await bank.evaluate((id) => {
    const el = document.getElementById('ibx_loginId');
    if (!el) return;
    el.focus();
    el.value = '';
    for (const ch of id) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
      el.value += ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, USER);
  LOG('은행 아이디 입력 완료');

  // 3) TransKey 키패드 열기 + 캡처 (확장 없이 evaluate)
  await overlay(bank, 'TransKey 키패드 캡처 중...');
  const kp = await captureLoginKeypad(bank);
  if (!kp) return;

  // 4) ICON 감지 + 문자 키 크롭 + VLM charMap
  const { icons, crops } = await cropCharKeys(bank, kp.imgB64, kp.keys);
  LOG(`ICON ${icons.length}개, 문자 키 ${crops.length}개`);
  const charMap = await recognizeCharMap(crops,
    'Output exactly one character shown in this image: a lowercase letter (a-z) or digit (0-9). Output nothing else.');
  LOG(`VLLM charMap (${Object.keys(charMap).length}/36):`, JSON.stringify(charMap));

  // 5) TransKey 비밀번호 입력 + 로그인 클릭
  await overlay(bank, '비밀번호 입력 + 로그인 중...');
  const typed = await typePassword(bank, '비밀번호', PASS, charMap);
  if (!typed.success) { LOG('비밀번호 입력 실패:', typed.error); return; }
  await bank.waitForTimeout(500);
  await bank.evaluate(() => {
    const btn = document.getElementById('btn_idLogin');
    if (btn) btn.click();
  });
  LOG('로그인 버튼 클릭 완료');
  await bank.waitForTimeout(6000);

  // 6) ID로그인 안내 레이어 처리
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
  LOG('ID로그인 안내 처리:', popupHandled);
  await bank.waitForTimeout(3000);

  const postState = await bank.evaluate(() => ({
    hasLoginForm: !!document.getElementById('wq_uuid_338'),
    url: location.href.slice(0, 80),
  }));
  LOG('로그인 후:', JSON.stringify(postState));
  if (postState.hasLoginForm) { LOG('로그인 폼 잔존 — 실패'); return; }
  LOG('로그인 성공!');

  // 7) 계좌 동기화
  const bankAccounts = await bank.evaluate(() => {
    const sel = document.getElementById('sbx_accno_input_0');
    if (!sel) return [];
    return [...sel.options].map(o => o.text.trim())
      .filter(t => t && t !== '선택하세요')
      .map(t => t.split('=')[0].trim());
  }).catch(() => []);
  if (bankAccounts.length) ACCOUNTS = syncEnvAccounts(bankAccounts);

  const accsToQuery = ACCOUNTS.filter(a => a.pw);
  if (!accsToQuery.length) {
    LOG('.env 에 계좌 비밀번호를 등록해 주세요 (ACCOUNTS=계좌:비밀번호)');
    return;
  }

  // 8) 조회기간 1년
  const periodSet = await bank.evaluate(() => {
    const radios = [...document.querySelectorAll('input.w2radio_input')];
    for (const r of radios) {
      const label = document.querySelector(`label[for="${r.id}"]`);
      if (label && label.textContent.trim().includes('1년')) {
        r.click(); r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }).catch(() => false);
  LOG('조회기간 1년 선택:', periodSet);

  // 9) 계좌별 조회 (숫자 키패드 VLM + TransKey)
  for (let i = 0; i < accsToQuery.length; i++) {
    const acc = accsToQuery[i];
    await overlay(bank, `계좌 조회 중... (${i + 1}/${accsToQuery.length}: ${acc.no})`);

    // 계좌 select에서 선택
    await bank.evaluate((accNo) => {
      const sel = document.getElementById('sbx_accno_input_0');
      if (!sel) return;
      for (const opt of sel.options) {
        if (opt.text.includes(accNo) || opt.value.includes(accNo)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, acc.no).catch(() => {});

    // 숫자 키패드 열기 + 키 앵커 좌표
    await bank.evaluate(() => {
      const el = document.getElementById('계좌비밀번호');
      if (el) { el.click(); if (typeof tk !== 'undefined' && tk.onKeyboard) tk.onKeyboard(el); }
    }).catch(() => {});
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
        }).filter(Boolean)
          // 중앙 3x4 숫자/아이콘 칸만 (기능키 h=78, close 25x25 제외)
          .filter(k => k.h === 38);
      }).catch(() => []);
    }
    if (!numKeys.length) { LOG(`숫자 키패드 없음 (${acc.no}) — 건너뜀`); continue; }

    // 숫자 키 clip 스크린샷 → VLM
    const numericCharMap = {};
    for (const k of numKeys) {
      const shot = await bank.screenshot({ clip: { x: k.x, y: k.y, width: k.w, height: k.h } }).catch(() => null);
      if (!shot) continue;
      const ch = await vlmReadKey(shot.toString('base64'),
        'Output exactly one character shown in this image: a digit (0-9) or a symbol. Output nothing else.');
      if (ch && numericCharMap[ch] === undefined) numericCharMap[ch] = k.idx;
    }
    LOG(`계좌 ${acc.no} 숫자 charMap (${Object.keys(numericCharMap).length}/10)`);

    // 숫자 비밀번호 TransKey 입력 + 조회 클릭
    const typed2 = await typePassword(bank, '계좌비밀번호', acc.pw, numericCharMap);
    if (!typed2.success) { LOG(`계좌비밀번호 입력 실패 (${acc.no}):`, typed2.error); continue; }
    await bank.waitForTimeout(500);
    await bank.evaluate(() => {
      const btn = document.getElementById('btn_조회');
      if (btn) btn.click();
    });
    LOG(`계좌 조회 ${i + 1}/${accsToQuery.length} (${acc.no}): 클릭 완료`);
    await bank.waitForTimeout(5000);

    // 시작 날짜를 1년 전으로 수정 후 재조회 (전체 기간 조회)
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
    await bank.evaluate(() => {
      const btn = document.getElementById('btn_조회');
      if (btn) btn.click();
    }).catch(() => {});
    await bank.waitForTimeout(5000);

    // 거래내역 텍스트 저장 → CSV
    const txt = await downloadTransactionsTxt(bank);
    if (txt && txt.content) {
      const monthCount = saveTransactionsTxtMonthly(acc.no.replace(/-/g, ''), txt.content);
      LOG(`거래내역 텍스트 저장: ${monthCount}개월치`);
    } else {
      LOG(`거래내역 없음/실패 (${acc.no}):`, txt ? txt.error : 'unknown');
    }
  }

  LOG('완료. 유지 중 (Ctrl+C로 종료)');
  await new Promise(() => {});
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
