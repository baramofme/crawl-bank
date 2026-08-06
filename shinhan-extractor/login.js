async function runInPage(body, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['tk.js'],
    world: 'MAIN'
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: body,
    args,
    world: 'MAIN'
  });
  return result.result;
}

async function openTranskeyKeypad() {
  return runInPage(async () => {
    const state = {
      tkExists: typeof tk !== 'undefined',
      tkNowId: (typeof tk !== 'undefined' && tk.now) ? tk.now.id : null,
      keypadDisplay: null
    };
    if (typeof tk !== 'undefined' && tk) {
      const pwInput = document.getElementById('비밀번호');
      if (pwInput) {
        tk.onKeyboard(pwInput);
        await new Promise(r => setTimeout(r, 800));
        const layout = document.getElementById('비밀번호_layout');
        state.keypadDisplay = layout ? getComputedStyle(layout).display : 'layout-not-found';
        state.tkNowId = tk.now ? tk.now.id : null;
      } else {
        state.error = '비밀번호 입력 필드를 찾을 수 없습니다';
      }
    } else {
      state.error = 'tk 객체가 없습니다. 페이지가 로드되었는지 확인하세요.';
    }
    return state;
  });
}

async function goToLoginPage() {
  await chrome.tabs.update({ url: 'https://bank.shinhan.com/rib/easy/index.jsp?cr=210000000000' });
  await new Promise(r => setTimeout(r, 3000));
  // 로그인 폼은 DOM에 있으나 숨김 처리되어 있을 수 있으므로 계좌조회 메뉴 클릭으로 항상 로그인 화면 이동
  await runInPage(() => {
    const el = document.getElementById('wq_uuid_147');
    if (el) el.click();
    return !!el;
  });
  await new Promise(r => setTimeout(r, 1500));
  await runInPage(() => {
    const el = document.getElementById('wq_uuid_154');
    if (el) el.click();
    return !!el;
  });
  await new Promise(r => setTimeout(r, 2000));
  return runInPage(() => {
    const processbar = document.getElementById('___processbar2');
    if (processbar && processbar.style.display !== 'none') {
      return { ready: false, message: '보안 프로그램 초기화 중...' };
    }
    return { ready: true, message: '페이지 로드 완료' };
  });
}

async function startKeypadTraining() {
  return runInPage(async () => trainKeypad());
}

async function getKeypadCharMap() {
  return runInPage(async () => getKeyCharMap());
}

async function getKeypadData() {
  return runInPage(async () => getKeypadImage());
}

// 계좌비밀번호 필드에 TransKey 숫자 키패드를 열고 캡처 (VLM charMap용)
async function openAccountKeypad() {
  return runInPage(async () => {
    const el = document.getElementById('계좌비밀번호');
    if (!el) return { error: '계좌비밀번호 필드를 찾을 수 없습니다' };
    el.click();
    return getNumericKeypadImage('계좌비밀번호');
  });
}

async function loginWithOcr(userId, userPw, charMap) {
  return runInPage(async (id, pw, map) => {
    const idInput = document.getElementById('ibx_loginId') ||
                    document.querySelector('input[placeholder="이용자ID"]');
    if (!idInput) return { success: false, error: '아이디 입력 필드를 찾을 수 없습니다' };
    plainInput(idInput, id);

    const pwInput = document.getElementById('비밀번호') ||
                    document.querySelector('input[type="password"]');
    if (!pwInput) return { success: false, error: '비밀번호 입력 필드를 찾을 수 없습니다' };

    try {
      if (!tk || !tk.now) tk.onKeyboard(pwInput);
      await new Promise(r => setTimeout(r, 300));
      typePasswordWithCharMap(pw, map);
    } catch (e) {
      return { success: false, error: 'TransKey OCR 입력 실패: ' + e.message };
    }

    const loginBtn = document.getElementById('btn_idLogin') ||
                     document.getElementById('wq_uuid_64');
    if (loginBtn) {
      loginBtn.click();
      return { success: true, message: '로그인 버튼 클릭 완료' };
    }
    return { success: false, error: '로그인 버튼을 찾을 수 없습니다' };
  }, [userId, userPw, charMap]);
}

async function fillLoginId(userId) {
  return runInPage((id) => {
    const idInput = document.getElementById('ibx_loginId') ||
                    document.querySelector('input[placeholder="이용자ID"]');
    if (!idInput) return { success: false, error: '아이디 입력 필드를 찾을 수 없습니다' };
    plainInput(idInput, id);
    return { success: true, value: idInput.value };
  }, [userId]);
}

async function shinhanLogin(userId, userPw) {
  return runInPage(async (id, pw) => {
    const idInput = document.getElementById('ibx_loginId') ||
                    document.querySelector('input[placeholder="이용자ID"]');
    if (!idInput) return { success: false, error: '아이디 입력 필드를 찾을 수 없습니다' };
    plainInput(idInput, id);

    const pwInput = document.getElementById('비밀번호') ||
                    document.querySelector('input[type="password"]');
    if (!pwInput) return { success: false, error: '비밀번호 입력 필드를 찾을 수 없습니다' };

    let pwMode = 'unknown';
    try {
      pwMode = await transkeyInput(pwInput, pw);
    } catch (e) {
      return { success: false, error: e.message };
    }

    const loginBtn = document.getElementById('btn_idLogin') ||
                     document.getElementById('wq_uuid_64');
    if (loginBtn) {
      loginBtn.click();
      return { success: true, message: '로그인 버튼 클릭 완료 (비밀번호 모드: ' + pwMode + ')' };
    }
    return { success: false, error: '로그인 버튼을 찾을 수 없습니다' };
  }, [userId, userPw]);
}

async function goToAccountPage() {
  await chrome.tabs.update({ url: 'https://bank.shinhan.com/rib/easy/index.jsp#210101000000' });
  await new Promise(r => setTimeout(r, 2000));
  return { success: true, message: '계좌조회 페이지 이동 완료' };
}

async function accountInquiry(accountNo, accountPw) {
  return runInPage(async (accNo, accPw) => {
    const accInput = document.querySelector('input[placeholder*="계좌"]') ||
                     document.querySelector('input[name*="account"]');
    if (!accInput) return { success: false, error: '계좌번호 입력 필드를 찾을 수 없습니다' };
    plainInput(accInput, accNo);
    accInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    accInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));

    const pwInput = document.getElementById('계좌비밀번호') ||
                    document.querySelector('input[type="password"]');
    if (!pwInput) return { success: false, error: '계좌 비밀번호 입력 필드를 찾을 수 없습니다' };

    try {
      await transkeyInput(pwInput, accPw);
    } catch (e) {
      return { success: false, error: e.message };
    }

    const buttons = document.querySelectorAll('a, button');
    for (const btn of buttons) {
      if (btn.textContent.includes('조회') && btn.offsetParent !== null) {
        btn.click();
        return { success: true, message: '조회 버튼 클릭 완료' };
      }
    }
    return { success: false, error: '조회 버튼을 찾을 수 없습니다' };
  }, [accountNo, accountPw]);
}

// 계좌 조회: 계좌번호 select에서 선택 + 계좌비밀번호를 VLM charMap으로 TransKey 입력 + 조회 클릭
async function accountInquiryWithVision(accountNo, accountPw, charMap) {
  return runInPage(async (accNo, accPw, map) => {
    const sel = document.getElementById('sbx_accno_input_0');
    if (!sel) return { success: false, error: '계좌번호 select를 찾을 수 없습니다' };
    let selected = false;
    for (const opt of sel.options) {
      if (opt.text.includes(accNo) || opt.value.includes(accNo) || opt.text.includes(accNo.replace(/-/g, ''))) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        selected = true;
        break;
      }
    }
    if (!selected) return { success: false, error: 'select에서 계좌를 찾을 수 없습니다: ' + accNo };

    const pwInput = document.getElementById('계좌비밀번호');
    if (!pwInput) return { success: false, error: '계좌비밀번호 필드를 찾을 수 없습니다' };
    if (!map || Object.keys(map).length === 0) return { success: false, error: 'charMap이 비어있습니다' };

    try {
      if (!tk || !tk.now) tk.onKeyboard(pwInput);
      await new Promise(r => setTimeout(r, 300));
      typePasswordWithCharMap(accPw, map);
    } catch (e) {
      return { success: false, error: '계좌비밀번호 TransKey 입력 실패: ' + e.message };
    }

    const btn = document.getElementById('btn_조회');
    if (btn) {
      btn.click();
      return { success: true, message: '조회 클릭 완료 (계좌: ' + accNo + ')' };
    }
    return { success: false, error: '조회 버튼을 찾을 수 없습니다' };
  }, [accountNo, accountPw, charMap]);
}

async function selectThreeMonths() {
  return runInPage(() => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = sel.querySelectorAll('option');
      for (const opt of options) {
        if (opt.textContent.includes('3개월') || opt.value === '3') {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: '3개월 선택 완료' };
        }
      }
    }
    const w2Selects = document.querySelectorAll('.w2selectbox_native_select');
    for (const sel of w2Selects) {
      const options = sel.querySelectorAll('option');
      for (const opt of options) {
        if (opt.textContent.includes('3개월') || opt.value === '3') {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: '3개월 선택 완료 (W2)' };
        }
      }
    }
    return { success: false, error: '조회기간 선택 필드를 찾을 수 없습니다' };
  });
}

async function downloadTransactionsCsv() {
  return runInPage(() => {
    const grids = document.querySelectorAll('.w2grid');
    for (const grid of grids) {
      if (grid.style.display === 'none') continue;
      const rows = grid.querySelectorAll('tr');
      if (rows.length === 0) continue;
      const csvRows = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        if (cells.length === 0) continue;
        const csvRow = Array.from(cells).map(cell => {
          let text = cell.textContent.trim();
          text = text.replace(/"/g, '""');
          return '"' + text + '"';
        }).join(',');
        csvRows.push(csvRow);
      }
      if (csvRows.length > 0) {
        return { success: true, csv: csvRows.join('\n') };
      }
    }
    return { success: false, error: '거래내역 테이블을 찾을 수 없습니다' };
  });
}
