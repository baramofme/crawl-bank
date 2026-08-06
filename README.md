# crawl-bank

신한은행 간편조회 자동화 프로젝트

## 개요

- **목표**: 신한은행 간편조회 서비스 자동화 (로그인 → 계좌조회 → 거래내역 CSV 추출)
- **방식**: 크롬 확장 프로그램 + SmolVLM2 Vision LLM (로컬 CPU)

## 프로젝트 구조

```
crawl-bank/
├── shinhan-extractor/       # 크롬 확장 프로그램 (Manifest V3)
│   ├── manifest.json        # 확장 설정 (host_permissions, world: MAIN)
│   ├── popup.html           # 확장 UI (로그인/계좌조회 폼)
│   ├── popup.js             # 이벤트 핸들러 + 로그
│   ├── login.js             # runInPage, 로그인/계좌조회/학습 기능
│   ├── tk.js                # TransKey 제어 (pagescript 주입용)
│   └── vision.js            # Vision LLM API 호출
├── vision_server.py         # SmolVLM2 Vision 서버 (llama-cpp-python)
├── ocr_server.py            # Tesseract OCR 서버 (폐기됨)
├── vlm/                     # SmolVLM2 모델 파일 (gitignore)
│   ├── models/              #   - Q8_0.gguf (175MB)
│   │   └── mmproj-Q8_0.gguf #   - mmproj (104MB)
│   └── llama-b10285/        # llama-server 바이너리
├── capture/                 # 신한은행 HTML 디버깅 캡처
└── README.md
```

## 작동 흐름

```
1. 로그인 페이지 이동 → 보안프로그램 초기화 대기
2. 키패드 문자 매핑:
   a. Vision: 키패드 이미지 → SmolVLM2 서버(localhost:8083) → JSON charMap
   b. 학습: 사용자가 a-z,0-9 순서대로 키패드 눌러서 매핑
3. 로그인: 아이디(plainInput) + 비밀번호(TransKey tk.start)
4. 계좌조회/거래내역 CSV (미완성)
```

## 기술적 도전과 해결

### TransKey 보안 키패드

신한은행은 **Raon TransKey** 가상 키패드를 사용합니다.
- 비밀번호 필드는 `readonly disabled`, 실제 입력 차단
- 키패드는 **세션마다 랜덤 배치** (문자 위치가 매번 바뀜)
- **신한은행 로고(더미 키)**가 45개 위치 중 9개에 섞여 있음

### 해결 과정

| 시도 | 방법 | 결과 |
|------|------|------|
| 1 | 고정 인덱스 매핑 (q→13, w→14...) | ❌ 키패드 랜덤 배치로 실패 |
| 2 | Tesseract OCR | ❌ 한글+영문 혼합에 max 17/36 |
| 3 | ocrad.js (순수 JS OCR) | ❌ CSP unsafe-eval 차단 |
| 4 | 서버 복호화 (getText) | ❌ 확장 컨텍스트 XHR 차단 |
| 5 | Object.defineProperty 인터셉트 | ❌ 미작동 |
| 6 | **SmolVLM2 Vision LLM** | ✅ 280MB, CPU 120t/s |
| 7 | **키패드 학습 모드** | ✅ 폴백, 사용자 수동 매핑 |

### 핵심 기술

1. **`tk.start(index)` 직접 호출**: `clickDummy=true`로 DKI 우회, 인덱스 기반 키 입력
2. **`world: 'MAIN'`**: `chrome.scripting.executeScript`에서 페이지 전역(`tk`) 접근
3. **`.gitkeep` → `tk.js` 파일명 변경**: Chrome `files` 캐시 우회
4. **`tk.onKeyboard()` 항상 호출**: `tk.now` 상태 무관하게 키패드 열기

## 실행 방법

### 1. Vision 서버 실행

```bash
cd ~/IdeaProjects/crawl-bank/vlm
LD_LIBRARY_PATH=llama-b10285 ./llama-b10285/llama-server \
  -m models/SmolVLM2-256M-Video-Instruct-Q8_0.gguf \
  --mmproj models/mmproj-SmolVLM2-256M-Video-Instruct-Q8_0.gguf \
  --port 8083 --host 127.0.0.1 -ngl 0 -c 2048 &
```

### 2. 확장 프로그램 로드

1. `chrome://extensions/` → 개발자 모드
2. "로드되지 않은 확장 프로그램을 가져옵니다"
3. `shinhan-extractor/` 폴더 선택

### 3. 사용

1. 신한은행 간편조회 접속: https://bank.shinhan.com/rib/easy/index.jsp
2. 확장 팝업 → 아이디/비밀번호 입력
3. **Vision 자동**: Vision 서버가 켜져 있으면 자동 인식 → 로그인
4. **수동 학습**: Vision 없으면 "키패드 학습" → a-z,0-9 순서대로 키패드 누르기

## 기술 스택

- **크롬 확장**: Manifest V3, chrome.scripting (world: MAIN)
- **TransKey 제어**: Raon TransKey 4.6, tk.start 인덱스 API
- **Vision**: SmolVLM2-256M (Q8_0), llama.cpp b10285, CPU 120t/s
- **Fallback OCR**: Tesseract (pytesseract), ocrad.js (폐기)
