const logs = [];

function addLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, message, type };
  logs.push(logEntry);
  
  const status = document.getElementById('status');
  const logDiv = document.createElement('div');
  logDiv.className = `log-entry log-${type}`;
  logDiv.textContent = `[${timestamp}] ${message}`;
  status.appendChild(logDiv);
  status.scrollTop = status.scrollHeight;
  
  console.log(`[ShinhanExtractor] ${message}`);
}

function showResult(result) {
  if (result && result.success) {
    addLog(`✓ ${result.message}`, 'success');
  } else {
    addLog(`✗ ${result ? result.error : '알 수 없는 오류'}`, 'error');
  }
}

async function safeRun(fn, logPrefix) {
  try {
    return await fn();
  } catch (e) {
    addLog(`${logPrefix} 예외: ${e.message || e.toString() || '알 수 없음'}`, 'error');
    return null;
  }
}

document.getElementById('trainKeys').addEventListener('click', async () => {
  addLog('키패드 학습 시작 (a-z,0-9 순서로 누르세요)', 'info');
  const result = await safeRun(() => startKeypadTraining(), '학습');
  if (result && result.charMap) {
    window.__savedCharMap = result.charMap;
    addLog(`학습 완료! ${result.count}/36 키 매핑됨`, 'success');
  }
});

document.getElementById('dummyTest').addEventListener('change', (e) => {
  if (e.target.checked) {
    document.getElementById('loginId').value = 'test123';
    document.getElementById('loginPw').value = 'test345';
    addLog('더미 테스트 모드 ON: test123 / test345', 'info');
  } else {
    addLog('더미 테스트 모드 OFF', 'info');
  }
});

document.getElementById('goToLogin').addEventListener('click', async () => {
  addLog('로그인 페이지 이동', 'info');
  const result = await goToLoginPage();
  addLog(result.message, result.ready ? 'success' : 'info');
});

async function ocrCharMap(imgB64, keys) {
  let worker;
  try {
    const readBlob = async (path, type = 'application/javascript') => {
      const resp = await fetch(chrome.runtime.getURL(path));
      const text = await resp.text();
      return URL.createObjectURL(new Blob([text], { type }));
    };
    const workerUrl = await readBlob('lib/tesseract/worker.min.js');
    const coreUrl = await readBlob('lib/tesseract/tesseract-core-simd.wasm.js');

    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: workerUrl,
      corePath: coreUrl,
      langPath: chrome.runtime.getURL('lib/tesseract/tessdata'),
      logger: (m) => { if (m.status === 'error') console.error('Tesseract:', m); }
    });
  } catch (e) {
    throw new Error('Tesseract worker 생성 실패: ' + (e.message || e));
  }
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz0123456789'
    });
  } catch (e) {
    await worker.terminate();
    throw new Error('setParameters 실패: ' + (e.message || e));
  }

  try {
    const img = new Image();
    img.src = 'data:image/png;base64,' + imgB64;
    await img.decode();
  } catch (e) {
    await worker.terminate();
    throw new Error('이미지 decode 실패: ' + (e.message || e));
  }

  const charMap = {};
  for (const key of keys) {
    const canvas = document.createElement('canvas');
    canvas.width = key.w * 3;
    canvas.height = key.h * 3;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, key.x, key.y, key.w, key.h, 0, 0, key.w * 3, key.h * 3);
    const { data } = await worker.recognize(canvas);
    const text = (data.text || '').trim().replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (text.length === 1 && charMap[text] === undefined) {
      charMap[text] = key.idx;
    }
  }
  await worker.terminate();
  return charMap;
}

async function ocrWithServer(imgB64, keys) {
  const resp = await fetch('http://127.0.0.1:8765', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imgB64, keys })
  });
  if (!resp.ok) throw new Error('서버 응답 ' + resp.status);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.charMap;
}

async function doOcrLogin() {
  let charMap = window.__savedCharMap;
  if (!charMap) {
    addLog('Vision API로 키패드 인식 시도...', 'info');
    const keypad = await safeRun(() => getKeypadData(), '키패드');
    if (keypad && keypad.imgB64) {
      charMap = await safeRun(() => ocrWithVision(keypad.imgB64, keypad.keys), 'Vision');
      if (charMap) {
        window.__savedCharMap = charMap;
        addLog(`Vision 인식: ${Object.keys(charMap).length}/36`, 'success');
      }
    }
    if (!charMap) {
      addLog('Vision 실패. "키패드 학습" 버튼으로 수동 매핑하세요', 'error');
      return;
    }
  }

  const userId = document.getElementById('loginId').value.trim();
  const userPw = document.getElementById('loginPw').value;
  if (!userId || !userPw) {
    addLog('아이디와 비밀번호를 입력하세요', 'error');
    return;
  }
  const loginResult = await safeRun(() => loginWithOcr(userId, userPw, charMap), '로그인');
  showResult(loginResult);
}

document.getElementById('openKeypad').addEventListener('click', async () => {
  addLog('TransKey 키패드 열기 시도', 'info');
  const result = await safeRun(() => openTranskeyKeypad(), '키패드');
  if (result) {
    addLog(`tk 존재: ${result.tkExists}`, 'info');
    addLog(`tk.now: ${result.tkNowId || '없음'}`, 'info');
    if (result.keypadDisplay) addLog(`키패드 표시 상태: ${result.keypadDisplay}`, 'info');
    if (result.error) addLog(`오류: ${result.error}`, 'error');
  }
});

document.getElementById('doLogin').addEventListener('click', async () => {
  addLog('로그인 시작 (OCR)', 'info');
  const userId = document.getElementById('loginId').value.trim();
  const userPw = document.getElementById('loginPw').value;
  if (!userId || !userPw) {
    addLog('아이디와 비밀번호를 입력하세요', 'error');
    return;
  }
  await doOcrLogin();
});

document.getElementById('goToAccount').addEventListener('click', async () => {
  addLog('계좌조회 페이지 이동', 'info');
  const result = await goToAccountPage();
  showResult(result);
});

document.getElementById('doAccountInquiry').addEventListener('click', async () => {
  addLog('계좌 조회 시작', 'info');
  const accountNo = document.getElementById('accountNo').value.trim();
  const accountPw = document.getElementById('accountPw').value;
  if (!accountNo || !accountPw) {
    addLog('계좌번호와 계좌 비밀번호를 입력하세요', 'error');
    return;
  }
  const result = await safeRun(() => accountInquiry(accountNo, accountPw), '계좌 조회');
  showResult(result);
});

document.getElementById('selectPeriod').addEventListener('click', async () => {
  addLog('조회기간 3개월 선택', 'info');
  const result = await selectThreeMonths();
  showResult(result);
});

document.getElementById('downloadCsv').addEventListener('click', async () => {
  addLog('거래내역 CSV 다운로드', 'info');
  const result = await downloadTransactionsCsv();
  if (result.success) {
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shinhan_transactions_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('✓ CSV 다운로드 완료', 'success');
  } else {
    showResult(result);
  }
});

document.getElementById('downloadLogs').addEventListener('click', () => {
  const logText = logs.map(log => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`).join('\n');
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shinhan_logs_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  addLog('로그 파일 다운로드 완료', 'success');
});

addLog('확장 프로그램 초기화 완료', 'success');
