const TK_LOWER = { 'q':13,'w':14,'e':15,'r':16,'t':17,'y':18,'u':19,'i':20,'o':21,'p':22,'[':23,']':24,
                   'a':25,'s':26,'d':27,'f':28,'g':29,'h':30,'j':31,'k':32,'l':33,';':34,
                   'z':35,'x':36,'c':37,'v':38,'b':39,'n':40,'m':41,',':42,'.':43,'/':44 };
const TK_DIGIT = { '1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'0':9 };
const TK_SYMBOL = { '!':0,'@':1,'#':2,'$':3,'%':4,'^':5,'&':6,'*':7,'(':8,')':9,'_':10,'+':11,
                    '{':23,'}':24,':':34,'<':42,'>':43,'?':44 };

function tkPress(index) {
  tk.start({ offsetX: 1, offsetY: 1 }, index);
}

function tkShift() {
  tkPress(55);
}

function tkTypeChar(ch) {
  if (TK_DIGIT[ch] !== undefined) {
    tkPress(TK_DIGIT[ch]);
  } else if (TK_LOWER[ch] !== undefined) {
    tkPress(TK_LOWER[ch]);
  } else if (TK_SYMBOL[ch] !== undefined) {
    tkShift();
    tkPress(TK_SYMBOL[ch]);
    tkShift();
  } else if (ch === '-') {
    tkPress(10);
  } else if (ch === '=') {
    tkPress(11);
  } else {
    const upper = TK_LOWER[ch.toLowerCase()];
    if (upper !== undefined) {
      tkShift();
      tkPress(upper);
      tkShift();
    } else {
      throw new Error('지원하지 않는 문자: ' + ch);
    }
  }
}

function waitForTk(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (typeof tk !== 'undefined' && tk) {
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getKeypadImage(fieldId = '비밀번호') {
  const dbg = {};
  try {
    dbg.waitTk = await waitForTk();
    const pwInput = document.getElementById(fieldId);
    dbg.pwExists = !!pwInput;
    if (pwInput) {
      dbg.pwRO = pwInput.readOnly;
      dbg.pwDisabled = pwInput.disabled;
    }
    dbg.tkNowBefore = tk.now ? tk.now.id : null;
    tk.onKeyboard(pwInput);
    dbg.tkNowAfter = tk.now ? tk.now.id : null;

    const lower = document.getElementById(fieldId + '_layoutLower');
    dbg.lowerExists = !!lower;
    if (!lower) return { error: 'layoutLower 요소 없음', debug: dbg };

    let bg = '';
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      bg = getComputedStyle(lower).backgroundImage;
      dbg['bg' + i] = bg ? bg.slice(0, 40) : 'null';
      if (bg && bg !== 'none') break;
    }
    dbg.finalBg = bg ? bg.slice(0, 60) : 'null';

    if (!bg || bg === 'none') return { error: '키패드 이미지 로드 안 됨', debug: dbg };

    const url = bg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '').trim();
    if (!url || url.length < 20) return { error: 'URL 추출 실패', bg: bg.slice(0, 60), url: url, debug: dbg };

    const keys = [];
    for (let i = 0; i < 45; i++) {
      const k = tk.getKeyByIndex(i, 'qwerty');
      keys.push({ idx: i, x: k.xpoints[0], y: k.ypoints[0], w: k.xpoints[1] - k.xpoints[0], h: k.ypoints[2] - k.ypoints[0] });
    }
    dbg.keyCount = keys.length;

    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { imgB64: btoa(binary), keys, debug: dbg };
  } catch (e) {
    return { error: '예외: ' + e.message, debug: dbg };
  }
}

const TK_SPECIAL_SHIFT = { '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-','+':'=' };

function typePasswordWithCharMap(value, charMap) {
  clickDummy = true;
  tk.now.clear();
  for (const ch of value) {
    const lower = ch.toLowerCase();
    if (TK_SPECIAL_SHIFT[ch] !== undefined) {
      const baseIdx = charMap[TK_SPECIAL_SHIFT[ch]];
      if (baseIdx === undefined) throw new Error('특수문자 베이스 키 미인식: ' + ch);
      tkShift();
      tkPress(baseIdx);
      tkShift();
    } else if (charMap[lower] !== undefined) {
      if (ch !== lower) {
        tkShift();
        tkPress(charMap[lower]);
        tkShift();
      } else {
        tkPress(charMap[lower]);
      }
    } else {
      throw new Error('인식된 키패드에 없는 문자: ' + ch);
    }
  }
}

async function transkeyInput(inputEl, value) {
  const state = {
    readOnly: inputEl.readOnly,
    disabled: inputEl.disabled,
    tkExists: typeof tk !== 'undefined',
    tkNowId: (typeof tk !== 'undefined' && tk.now) ? tk.now.id : null,
    tkNowAllocated: (typeof tk !== 'undefined' && tk.now) ? tk.now.allocate : null
  };
  console.log('[ShinhanTranskey] 상태:', JSON.stringify(state));

  if (!inputEl.readOnly && !inputEl.disabled) {
    plainInput(inputEl, value);
    return 'plain';
  }

  const tkReady = await waitForTk();
  if (!tkReady) {
    inputEl.readOnly = false;
    inputEl.disabled = false;
    plainInput(inputEl, value);
    return 'plain-fallback(no-tk)';
  }

  try {
    tk.onKeyboard(inputEl);
    await sleep(500);
    console.log('[ShinhanTranskey] onKeyboard 후 now:', tk.now ? tk.now.id : 'null');
    clickDummy = true;
    tk.now.clear();
    for (let i = 0; i < value.length; i++) {
      tkTypeChar(value[i]);
    }
    console.log('[ShinhanTranskey] 입력 완료, 길이:', inputEl.value.length);
    return 'transkey';
  } catch (e) {
    console.log('[ShinhanTranskey] TransKey 실패:', e.message);
    inputEl.readOnly = false;
    inputEl.disabled = false;
    plainInput(inputEl, value);
    return 'plain-fallback(error: ' + e.message + ')';
  }
}

function plainInput(inputEl, value) {
  inputEl.focus();
  inputEl.value = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    inputEl.value += char;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
  }
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}

// 숫자 키패드(계좌비밀번호) 캡처: tk.start(event,N) 요소들의 layout 기준 상대 좌표
async function getNumericKeypadImage(fieldId = '계좌비밀번호') {
  const dbg = {};
  try {
    dbg.waitTk = await waitForTk();
    const pwInput = document.getElementById(fieldId);
    if (!pwInput) return { error: '필드 없음: ' + fieldId, debug: dbg };
    tk.onKeyboard(pwInput);

    const layout = document.getElementById(fieldId + '_layout');
    if (!layout) return { error: 'layout 요소 없음', debug: dbg };

    let bg = '';
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      bg = getComputedStyle(layout).backgroundImage;
      if (bg && bg !== 'none') break;
    }
    if (!bg || bg === 'none') return { error: '키패드 이미지 로드 안 됨', debug: dbg };

    const url = bg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '').trim();

    const layoutRect = layout.getBoundingClientRect();
    const keys = [];
    layout.querySelectorAll('a[onclick*="tk.start"]').forEach((a) => {
      const m = a.getAttribute('onclick').match(/tk\.start\(event,(\d+)\)/);
      if (!m) return;
      const r = a.getBoundingClientRect();
      keys.push({
        idx: parseInt(m[1], 10),
        x: Math.round(r.x - layoutRect.x),
        y: Math.round(r.y - layoutRect.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    });
    keys.sort((a, b) => a.idx - b.idx);

    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { imgB64: btoa(binary), keys, debug: dbg };
  } catch (e) {
    return { error: '예외: ' + e.message, debug: dbg };
  }
}
