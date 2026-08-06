# crawl-bank

신한은행 간편조회 자동화 프로젝트 (로그인 → 계좌조회 → 거래내역 CSV)

## 개요

- **목표**: 신한은행 간편조회 자동화 (로그인 → 계좌조회 → 거래내역 CSV 추출)
- **방식**: 크롬 확장 프로그램 + Playwright(connectOverCDP) + LFM2.5-VL-450M Vision LLM (로컬 CPU)

## 프로젝트 구조

```
crawl-bank/
├── driver-noext.js          # ★ Playwright 단독 드라이버 (크롬 확장 불필요 — 권장)
├── driver.js                # 크롬 확장 기반 드라이버 (확장 테스트용)
├── playwright.config.js     # Playwright 설정 (CDP 9222)
├── tests/extension.spec.js  # 확장 조작 검증 테스트
├── shinhan-extractor/       # 크롬 확장 프로그램 (Manifest V3, 선택 사항)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── login.js             # runInPage, 로그인/계좌조회/숫자 키패드
│   ├── tk.js / transkey.js  # TransKey 제어 + 키패드 캡처
│   └── vision.js            # Vision LLM API 호출
├── vlm/
│   ├── llama-b10285/        # llama-server 바이너리 (커밋됨)
│   ├── download-models.sh   # 모델 다운로드 (Linux/macOS)
│   ├── download-models.cmd  # 모델 다운로드 (Windows CMD)
│   ├── download-models.ps1  # 모델 다운로드 (PowerShell)
│   └── models/              # 모델 파일 (gitignore, 다운로드 필요)
│       ├── LFM2.5-VL-450M-Q8_0.gguf        (362MB)
│       └── mmproj-LFM2.5-VL-450m-Q8_0.gguf (99MB)
├── docs/research/           # 연구 문서 (로그인/조회/진행상황)
└── README.md
```

## 준비 (1회)

### 1. 모델 다운로드

```bash
cd vlm
./download-models.sh        # Linux/macOS
# 또는 .\download-models.ps1 (PowerShell) / download-models.cmd (CMD)
```

### 2. 확장 프로그램 설치 (Chrome 137+ --load-extension 차단 → 수동 설치 필수)

```bash
# Chrome을 banking ext 프로필 + CDP 9222로 실행
/usr/bin/google-chrome-stable --user-data-dir=/tmp/pw-banking-ext \
  --remote-debugging-port=9222 --no-first-run about:blank &
```

1. `chrome://extensions/` → 개발자 모드
2. "압축해제된 확장 프로그램을 로드합니다" → `shinhan-extractor/` 선택
3. 신한은행 로그인 시 "Access other apps and services" 모달 → **Allow 1회** (프로필에 저장)

### 3. .env 설정

```bash
cp .env.example .env
# ID=신한은행 이용자ID
# PW=로그인 비밀번호
# ACCOUNTS=계좌번호:계좌비밀번호,계좌번호2:비번2  (콤마 구분, 여러 개 가능)
```

> 계좌 비밀번호를 비워두면 로그인 후 계좌 select에서 목록을 자동으로 .env에 동기화해줌

## 실행 방법

### 1. VLM 서버 실행

```bash
cd vlm
./llama-b10285/llama-server \
  -m models/LFM2.5-VL-450M-Q8_0.gguf \
  --mmproj models/mmproj-LFM2.5-VL-450m-Q8_0.gguf \
  --port 8083 --host 127.0.0.1 -ngl 0 -c 4096 &
```

### 2. Playwright 테스트 (확장 동작 검증)

```bash
# 전제: Chrome CDP 9222 실행 상태
NODE_PATH=$(npm root -g) npx playwright test
```

- `tests/extension.spec.js` — 확장 popup 로드, 은행 페이지 접근, 컨트롤 버튼 확인
- connectOverCDP로 기존 Chrome(9222)을 제어 (프로필의 확장/allow 권한 유지)

### 2. 전체 자동화 — Playwright 단독 (driver-noext.js, 권장)

크롬 확장 없이 `page.evaluate()`로 TransKey를 직접 조작합니다.

```bash
cd ~/IdeaProjects/crawl-bank
setsid env NODE_PATH=$(npm root -g) node driver-noext.js > /tmp/opencode/driver-noext.log 2>&1 < /dev/null &
```

자동 수행 흐름:

```
1. 로그인 (ID 입력 → TransKey 키패드 캡처 → VLM charMap(34/36) → 비밀번호 입력)
2. ID로그인 안내 팝업 자동 처리
3. 계좌 select에서 .env ACCOUNTS 자동 동기화
4. 조회기간 1년 선택
5. 계좌비밀번호 숫자 키패드 → VLM 인식 → TransKey 입력
6. 계좌 조회 → 시작일 1년 전 재조회 (전체 기간)
7. 파일저장 → 텍스트 저장(서버 정리본) → 연도/월별 CSV 저장 + 증분 병합
   → capture/2026/{월}/transactions_{계좌}.csv
```

### 3. 전체 자동화 — 확장 기반 (driver.js)

크롬 확장을 설치한 상태에서 확장 popup을 통해 조작하는 버전 (확장 테스트/개발용).

```bash
cd ~/IdeaProjects/crawl-bank
setsid env NODE_PATH=$(npm root -g) node driver.js > /tmp/opencode/driver-run.log 2>&1 < /dev/null &
```

> driver-noext.js와 동일한 결과를 제공하지만 확장 설치가 필요합니다.
> 확장 없이도 동일 기능이 동작하므로 신규 사용은 driver-noext.js 권장.

## 기술적 도전과 해결

### TransKey 보안 키패드

신한은행은 **Raon TransKey** 가상 키패드를 사용합니다.
- 비밀번호 필드는 `readonly disabled`, 실제 입력 차단
- 키패드는 **세션마다 랜덤 배치** (문자 위치가 매번 바뀜)
- 로그인 키패드: 45키 (영문/숫자 + 아이콘 셔플)
- 계좌비밀번호 키패드: **숫자 전용 17키** (중앙 3x4 + 좌우 Enter/⌫)
- 대문자/특수문자: Shift(인덱스 55) + 베이스 키 조합 (예: `@` = Shift + `2`)

### 해결 과정

| 시도 | 방법 | 결과 |
|------|------|------|
| 1~7 | Tesseract/ocrad/서버복호화 등 | ❌ 실패 |
| 8 | **LFM2.5-VL-450M Vision LLM** | ✅ 개별 키 4x 크롭 → 34/36 |
| 9 | **숫자 키패드 clip-VLM** | ✅ 계좌비밀번호 인식 |
| 10 | **Playwright connectOverCDP** | ✅ Chrome 137+ 확장 로드 차단 우회 |
| 11 | **Playwright 단독 (driver-noext)** | ✅ 확장 없이 전 과정 자동화 |

### 핵심 기술

1. **connectOverCDP**: Playwright가 프로필을 직접 열면 확장이 안 로드됨(Chrome 137+ `--load-extension` 차단) → 기존 Chrome(9222)에 붙어 제어
2. **고정 프로필**(`/tmp/pw-banking-ext`): allow 권한 저장 → 1회 allow로 반복 실행 가능
3. **확장 없는 TransKey 제어**: `page.evaluate()`가 페이지 메인 world에서 `tk` 객체에 직접 접근 → `tk.start(index)` 호출, 키패드 스프라이트 캡처, VLM charMap
4. **숫자 키패드 인식**: 중앙 3x4 키(h=38)만 clip 스크린샷 → LFM 개별 인식 (기능키 h=78 제외)
5. **거래내역 저장**: 파일저장 팝업(iframe CO00012RP) → 전체 열 체크 → 텍스트 저장(서버 정리본, 세미콜론 구분) → 연도/월별 CSV + 증분 병합

## 연구 문서

- `docs/research/STATUS.md` — 전체 진행상황 (다음 세션 이어가기용)
- `docs/research/login/` — 로그인 파이프라인 (보안프로그램/키패드/모델)
- `docs/research/extract/` — 계좌 조회/거래내역 파싱

## 기술 스택

- **크롬 확장**: Manifest V3, chrome.scripting (world: MAIN)
- **자동화**: Playwright (connectOverCDP, CDP 9222)
- **Vision**: LFM2.5-VL-450M (Q8_0), llama.cpp b10285, CPU
- **TransKey**: Raon TransKey, tk.start 인덱스 API
