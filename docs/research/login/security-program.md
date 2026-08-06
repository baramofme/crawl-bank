# 연구: 보안 프로그램 실행 및 인식 방법

> 신한은행이 요구하는 호스트 보안 프로그램(AhnLab Safe Transaction / ASTx)을
> 자동화 브라우저에서 실행하고, 페이지가 이를 인지하게 만드는 방법.
> **현재 가장 큰 차단 문제.** 로그인 제출 시 "인터넷뱅킹 보안프로그램설치안내" 팝업만 뜨고 실제 로그인이 안 됨.

## 환경 구성 (확인된 사실)

| 구성 요소 | 상태 |
|-----------|------|
| `astxdaemon` (root, `/opt/AhnLab/ASTx`) | ✅ 실행 중 (`--system` 모드) |
| `astx-ui` (사용자 레벨 연동 UI) | ⚠️ defunct였다가 **수동 재기동 성공** (DISPLAY=:0 필요) |
| AhnLab Chrome 확장 / Native Messaging Host | ❌ 없음 (NMH엔 CrossWebEx `kr.co.iniline.crosswebex`만 있음) |
| 시스템 Chrome | `/usr/bin/google-chrome-stable` (v151) — 보안 프로그램 연동됨 |
| Playwright 번들 chromium | 보안 프로그램 **인지 안 됨** (사용자 확인) |
| `/dev/hidraw*` | root 소유 (`crw-------`) — udev 규칙 없음 |

## 해결된 문제 1: "Access other apps and services" 모달

- 정체: Chrome 124+에서 WebHID/WebUSB/WebSerial 통합 권한 프롬프트. AhnLab이 이를 통해 호스트 상태를 체크
- Playwright `grantPermissions(['serial','usb','hid'])` → **미지원** ("Unknown permission: serial")
- 네이티브 모달이라 Playwright dialog 이벤트로도 안 잡힘
- 해결책 (조합):
  1. **고정 프로필** `/tmp/pw-shinhan-ext` — 사용자가 Allow 1회 클릭하면 영구 저장 (기존 `Date.now()` 프로필은 매번 리셋이 원인)
  2. **CDP `Browser.setPermission`** (serial/usb/hid, origin 지정) — 에러 없이 통과

## 해결된 문제 2: 시스템 Chrome에서 확장 로드 (Chrome 137+ 차단)

- Chrome 137부터 `--load-extension` 커맨드라인 스위치가 기본 차단됨
- `--disable-features=DisableLoadExtensionCommandLineSwitch` → Chrome 151에선 안 먹음
- page CDP 세션 `Extensions.loadUnpacked` → "Method not available"
- **browser CDP 세션** `browser.newBrowserCDPSession()` + `Extensions.loadUnpacked({path})` → ✅ 성공
  - 결과 id가 `extensionIdFromPath` 계산과 동일 (efnhhmncoflmkccmcdnodpeekalfbbbe)
- 미해결: loadUnpacked 직후 `chrome-extension://.../popup.html` 접근 시 `ERR_BLOCKED_BY_CLIENT`
  - → driver.js에 4회 재시도 루프 추가 (1.5s 간격) — 검증 중

## 미해결: 호스트 보안 프로그램 인지 실패

현재 상태: allow 모달 해결, astx-ui 재기동, 시스템 Chrome 전환까지 했지만
로그인 제출 시 여전히 "보안프로그램설치안내" 팝업 → **AhnLab이 페이지에서 인지 안 됨**.

### 가설 (조사 순서)

1. **AhnLab 확장/Native Messaging 부재** — AhnLab은 Chrome 확장 + NMH로 동작할 수 있음.
   `~/.config/google-chrome/NativeMessagingHosts/`에 astx 관련 JSON 없음. AhnLab 공식 설치로 확장이 생기는지 확인
2. **WebHID 장치 접근** — ASTx가 가상 HID 장치를 만들고 `/dev/hidraw*` 접근이 필요한데 root 소유 + udev 규칙 없음.
   AhnLab 설치 시 생성되는 udev 규칙 존재 여부 확인 필요 (`/etc/udev/rules.d/`)
3. **ASTx 데몬 상태** — `astxdaemon --system`만 떠 있고, 브라우저 연동 컴포넌트(astx-ui)가 정상 동작하는지.
   astx-ui는 수동 재기동했지만 아직 페이지 인지가 안 되므로, 데몬-브라우저 채널(WebSocket/포트) 확인 필요
4. **Chrome 바이너리 등록** — ASTx가 특정 Chrome 경로와만 연동 등록됐을 수 있음.
   Playwright chromium(ms-playwright)으로는 인지 안 된다는 사용자 확인 → 시스템 Chrome으로 전환 완료

### 다음 세션 조사 명령

```bash
# AhnLab 연동 흔적
find / -name "*astx*" -o -name "*ahnlab*" 2>/dev/null | grep -iE "messag|manifest|udev|json" | head

# udev 규칙 (WebHID 장치 접근 권한)
ls /etc/udev/rules.d/ | grep -iE "ahn|astx|hid"

# ASTx 로그 (암호화되어 있어 직접 읽기는 어려움)
ls -la /opt/AhnLab/ASTx/Logs/

# ASTx 데몬이 연 소켓/포트
sudo ss -tlnp | grep -iE "astx|aos|8888|9010"
```

## ✅ 해결 후 전체 원인 정리 (4문항)

### Q1. 처음 Chrome(Playwright 번들 chromium)은 왜 보안 프로그램 인식이 안 됐나?

- AhnLab ASTx는 호스트(astxdaemon/astx-ui)와 브라우저가 WebHID("Access other apps" 모달)로 통신하며, 이 연동은 **브라우저 바이너리 기준으로 동작**
- Playwright 번들 chromium(`~/.cache/ms-playwright/`)은 AhnLab이 등록/연동한 브라우저가 아니라서 WebHID 장치 연결이 막히고, 페이지가 호스트를 감지 못함
- → 시스템 Chrome(`/usr/bin/google-chrome-stable`)으로 전환해야 AhnLab 연동이 동작 (사용자 확인)

### Q2. 시스템 Chrome은 왜 확장 설치/인식이 안 됐는데 CDP 리모트 접속(connectOverCDP) 하니까 됐나?

- **Chrome 137+부터 `--load-extension` 커맨드라인 스위치가 보안상 기본 차단** → Playwright가 새 인스턴스를 띄우면서 플래그로 확장을 로드하려 해도 실패 (ERR_BLOCKED_BY_CLIENT)
- CDP `Extensions.loadUnpacked`도 Chrome 151에서 id만 반환하고 실제 chrome://extensions 등록/접근은 실패
- **connectOverCDP는 "이미 실행 중인 Chrome 프로세스"에 붙어 제어**하는 방식이라, Chrome의 확장 로딩 시스템이 새로 개입하지 않음. 사용자가 수동 설치한 확장 + allow 권한 + AhnLab WebHID 연동이 **그 프로세스 상태에 그대로 유지**되므로 chrome-extension:// 접근이 가능해짐
- 요약: Playwright가 Chrome을 새로 여는 게 문제 → 기존 Chrome을 조종하는 connectOverCDP가 해법

### Q3. 왜 확장은 수동 설치, allow 팝업도 수동 확인인가?

- Chrome 137+ 보안 정책: 명령줄/자동 확장 설치 차단 (악성 확장 자동 설치 방지) → **개발자 모드 확장 설치는 사용자 제스처(UI 클릭) 필수**
- WebHID/WebUSB/WebSerial 같은 device 권한은 사용자 명시적 동의 필수. `grantPermissions`도 usb/serial/hid 미지원, 네이티브 모달은 Playwright dialog 이벤트로도 안 잡힘
- → 확장 1회 수동 설치 + allow 1회 수동 클릭이 불가피

### Q4. 프로필을 만들지 않으면 왜 3번 과정을 스킵하지 못하는가?

- allow 권한(WebHID)과 확장 설치 상태는 **브라우저 프로필에 저장**됨
- Playwright가 매번 새 프로필(`/tmp/pw-...-Date.now()`)을 만들면 저장된 권한/확장이 없어 **매 실행마다 allow/설치를 반복**해야 함
- **고정 프로필(`/tmp/pw-banking-ext`)** 을 재사용하면 한 번만 allow/설치하면 이후 자동 → 3번 과정 스킵 가능
- 단, 고정 프로필을 Playwright가 직접 열면(launchPersistentContext) 확장이 안 로드되므로, **Chrome을 `--remote-debugging-port=9222`로 띄우고 connectOverCDP로 제어**하는 것이 필수 조합

### 최종 해법 요약

```
시스템 Chrome + 고정 프로필(/tmp/pw-banking-ext) + --remote-debugging-port=9222
→ 사용자 1회 수동: 확장 설치(chrome://extensions 개발자 모드) + allow 클릭
→ 이후: connectOverCDP로 driver.js가 제어 → 확장/보안프로그램 모두 동작
```

## 진행 상태: 🟢 해결

- [x] allow 모달 해결 (고정 프로필 + CDP setPermission)
- [x] 시스템 Chrome 전환 (보안 프로그램 연동 브라우저)
- [x] Chrome 137+ 확장 로드 우회 (browser CDP Extensions.loadUnpacked)
- [ ] popup.html ERR_BLOCKED_BY_CLIENT 해결 (재시도 루프 검증 중)
- [ ] AhnLab 호스트 인지 — "보안프로그램설치안내" 팝업 제거
- [ ] 실제 로그인 제출 성공 (더미 계정으로 파이프라인 검증)

## 관련 파일

- `driver.js` — 실행 인자, CDP 확장 로드, 고정 프로필, 로그인 후 상태 검증
- `/opt/AhnLab/ASTx/` — astxdaemon, astx-ui, Logs
- `~/.config/google-chrome/NativeMessagingHosts/` — CrossWebEx만 존재
- 로그: `/tmp/opencode/driver-run14.log`(chromium, 보안 팝업 잔존 확인), `driver-run17~21.log`(시스템 Chrome 전환 시도)
