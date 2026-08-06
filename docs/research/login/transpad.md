# 연구: TransKey 키패드 (transpad)

> 신한은행 로그인 비밀번호 입력에 사용되는 Raon TransKey 가상 키패드.
> 세션마다 키가 랜덤 배치되며, 한글 자모 + 영문 + 숫자 + 더미(신한 로고) 키가 45개 위치에 섞여 있다.

## 키패드 구조

- 비밀번호 input(`#비밀번호`)은 `readonly` — 직접 입력 불가, TransKey로만 입력
- 키패드 키 45개 = 문자 키 36개(영문 26 + 숫자 10) + 아이콘(더미) 키 8~9개
- 아이콘 키: 신한은행 로고, **위치가 세션마다 변하고, 한 줄당 2개 고정**
- 키마다 좌표는 TransKey 내부에서 제공 → 이미지 탐지 없이 정확한 좌표 확보 가능

## 핵심 API / 신호

| 항목 | 내용 |
|------|------|
| `tk.start({offsetX:1, offsetY:1}, index)` | 인덱스 기반 키 입력 (직접 호출로 DKI 우회, `clickDummy=true`) |
| `getKeypadData()` | 스프라이트 이미지(base64) + 45키 좌표 배열 반환 |
| `tk.now` | 현재 포커스된 필드 (예: "비밀번호") |
| `transkeyUuid` (hidden input) | **초기화 완료 신호** — 32~64자 hex 값이 채워지면 TransKey 준비 완료 |
| `___processbar2` | 보안 프로그램 로딩바 — display:none이면 초기화 완료 |

## 초기화 완료 판정 (driver.js)

```js
const pb = document.getElementById('___processbar2');
const pw = document.getElementById('비밀번호');
const tu = document.getElementById('transkeyUuid');
const uuidOk = tu && /^[0-9a-f]{32,64}$/i.test(tu.value || '');
return pw !== null && (!pb || pb.style.display === 'none') && uuidOk;
```

## 문자 → 인덱스 매핑 (charMap)

- VLM이 키패드 이미지를 보고 문자(a-z, 0-9) → 키 인덱스 매핑 생성
- 비밀번호 입력: `typePasswordWithCharMap(value, charMap)` → 각 문자를 인덱스로 변환 → `tk.start(idx)`
- 대문자/특수문자는 Shift 키 인덱스 필요 (TK_SPECIAL_SHIFT) — 현재 비밀번호는 소문자+숫자만 사용

## 해결된 문제

1. **고정 인덱스 매핑 실패** → 세션마다 랜덤 배치라서 불가. 매 세션 VLM으로 charMap 재생성 필요
2. **키패드 캡처**: 페이지의 키패드 DOM을 직접 캡처하는 `getKeypadData()` 사용
3. **ICON(더미) 키 감지**: 픽셀 컬러 비율 >5%로 100% 정확 — 문자 키 36개만 VLM에 전달

## 진행 상태: 🟢 대부분 해결

- [x] tk.start 인덱스 입력 경로 확인
- [x] 45키 좌표 추출 (capture/keypad.png + keypad_keys.json)
- [x] transkeyUuid로 초기화 완료 판정
- [x] ICON 픽셀 감지
- [ ] 대문자/특수문자 Shift 입력 (더미 비번 test345는 불필요 — 실제 사용 시 필요할 수 있음)
- [ ] 로그인 제출 후 서버 응답 검증 (보안 프로그램 문제와 연계)

## 관련 파일

- `shinhan-extractor/tk.js` — tk 제어 (pagescript 주입용)
- `shinhan-extractor/transkey.js` — typePasswordWithCharMap
- `shinhan-extractor/login.js` — loginWithOcr (TransKey 입력 + 로그인 버튼 클릭)
- `capture/keypad.png`, `capture/keypad_keys.json` — 세션별 캡처 결과
