# 로그인 성공 연구 계획 (Research Plan)

> 목적: 신한은행 간편조회 로그인(TransKey 키패드 + 보안 프로그램)을 자동화하기 위한 연구 목록과 진행 상황 기록.
> 이 문서를 보고 다음 세션이 바로 이어서 작업할 수 있게 하는 것이 목표.

## 최종 목표

`driver.js` 실행 시 다음 흐름이 전부 자동으로 동작해 실제 로그인까지 완료되는 것:

```
1. 로그인 페이지 이동
2. 보안 프로그램 설치 팝업 닫기
3. 계좌조회 메뉴 클릭으로 로그인 화면 이동 (wq_uuid_147 → wq_uuid_154)
4. 로그인 폼 확인 (wq_uuid_338 + 비밀번호 input 존재 + visible)
5. 없으면 hidden → show (grpLoginArea 등 조상의 display:none 해제)
6. 로그인 진행: 아이디 입력 → TransKey 키패드 열기 → 키패드 캡처
   → VLM charMap 추출 → TransKey로 비밀번호 입력 → 로그인 제출
```

## 연구 항목 목록

| # | 연구 항목 | 문서 | 상태 | 비고 |
|---|-----------|------|------|------|
| 1 | TransKey 키패드 구조/제어 | `transpad.md` | 🟢 대부분 해결 | tk.start 인덱스 입력, 45키 좌표 추출, transkeyUuid 초기화 신호 |
| 2 | 키패드 문자 인식 (VLM) | `keypad-recognition.md` | 🟢 해결 (34/36) | LFM2.5-VL-450M + 개별 키 크롭 + min_p 파라미터 |
| 3 | 보안 프로그램 실행/인지 | `security-program.md` | 🔴 미해결 (진행 중) | AhnLab ASTx 인지 실패 → 로그인 제출 차단됨 |

## 현재 차단 상태 (가장 중요)

**보안 프로그램(AhnLab ASTx)이 페이지에서 인지되지 않아, 로그인 제출 시 "인터넷뱅킹 보안프로그램설치안내" 팝업만 뜨고 실제 로그인이 진행되지 않음.**

확인된 사실:
- `astxdaemon`(root) 실행 중, `astx-ui`는 defunct였다가 수동 재기동 성공
- allow 모달("Access other apps and services")은 고정 프로필 + CDP 권한 설정으로 해결됨
- Playwright 번들 chromium에서는 보안 프로그램이 인지 안 됨 → **시스템 Chrome(`/usr/bin/google-chrome-stable`) 필요**
- 시스템 Chrome(151)은 `--load-extension` 차단 → CDP `Extensions.loadUnpacked`(browser 세션)로 확장 로드 성공
- 그러나 확장 popup.html 로드 시 `ERR_BLOCKED_BY_CLIENT` 발생 → 재시도 루프 추가 후 검증 중 (driver-run21)

## 다음 세션의 첫 작업

1. `driver-run21.log` 확인 — CDP loadUnpacked 후 popup.html 재시도 루프가 통과했는지
2. 시스템 Chrome + 확장 로드 성공 시: 전체 흐름 재실행 → "보안 프로그램 설치" 팝업이 사라지는지 확인
3. 안 사라지면 `security-program.md`의 미해결 항목(udev 규칙, WebHID 장치, AhnLab 확장/Native Messaging) 조사

## 실행 방법 (드라이버)

```bash
cd ~/IdeaProjects/crawl-bank
# VLM 서버 (LFM2.5-VL-450M, 8083) 먼저 실행
cd vlm && ./llama-b10285/llama-server -m models/LFM2.5-VL-450M-Q8_0.gguf \
  --mmproj models/mmproj-LFM2.5-VL-450m-Q8_0.gguf \
  --port 8083 --host 127.0.0.1 -ngl 0 -c 4096 &

# 드라이버 실행 (더미 모드 ON: test123/test345)
cd ~/IdeaProjects/crawl-bank
setsid env NODE_PATH=$(npm root -g) node driver.js > /tmp/opencode/driver-run.log 2>&1 < /dev/null &
```

- 프로필: `/tmp/pw-shinhan-ext` (고정 — device allow 권한 저장됨, 삭제 금지)
- 로그: `/tmp/opencode/driver-run*.log`

## 로그인 성공 판정 기준

- `로그인 후 은행 상태` 로그에서 `popupText`에 "보안프로그램설치안내"가 없어야 함
- `hasLoginForm: false` (로그인 폼 사라짐) 또는 URL이 로그인 후 페이지로 변경
- 더미 계정(test123/test345)이므로 서버가 "아이디/비밀번호 오류"를 반환해도 파이프라인은 성공한 것
