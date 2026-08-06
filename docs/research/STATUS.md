# RESEARCH STATUS — 신한은행 자동화 진행상황 (세션 연속용)

> **이 문서가 최우선 진실 공급원.** 다음 세션은 이 문서를 읽고, 하단 "다음 세션 실행 지침"을 그대로 수행하면 된다.
> 세부 연구 내용은 각 항목 링크의 문서를 참조.

> 마지막 업데이트: 2026-08-07 05:00

---

## 1. 현재 전체 상태 요약

| 영역 | 상태 | 요약 |
|------|------|------|
| 로그인 자동화 | 🟢 완성 | 로그인 → 안내 팝업 처리 → 계좌조회 진입 (run31+) |
| 계좌 동기화 | 🟢 완성 | 로그인 후 계좌 select에서 .env ACCOUNTS 자동 동기화 |
| 조회기간 설정 | 🟢 완성 | 3개월 라디오 선택 + 시작 날짜 1년 전 재조회 |
| 숫자 키패드 VLM | 🟢 완성 | 계좌비밀번호: clip 스크린샷 → LFM 인식 10/10 → TransKey 입력 |
| 계좌 조회 | 🟢 완성 | run45: 조회 성공 |
| 거래내역 저장 | 🟢 완성 | 파일저장→텍스트 저장(서버 정리본) → 연도/월별 CSV + 증분 병합 |
| CSV 검증 | 🟢 완성 | capture/2026/{05,06,07,08}/transactions_110299717889.csv (37건) |
| 증분 병합 | 🟢 검증 완료 | 중복 없음/새 거래 추가/내용 갱신 모두 확인 |
| 페이징 | 🟡 보류 | 텍스트 저장이 전체 데이터를 반환하므로 불필요할 수 있음 (대량 거래 시 확인) |

## 2. 실행 방법 (드라이버)

```bash
# 0) VLM 서버 (LFM2.5-VL-450M, 8083) 확인
curl -s -m 3 http://127.0.0.1:8083/health >/dev/null && echo VLM-OK

# 1) Chrome을 banking ext 프로필 + CDP 포트로 실행 (확장 설치 상태 유지)
/usr/bin/google-chrome-stable --user-data-dir=/tmp/pw-banking-ext \
  --remote-debugging-port=9222 --no-first-run about:blank &

# 2) 드라이버 실행 (connectOverCDP로 Chrome 제어)
cd ~/IdeaProjects/crawl-bank
setsid env NODE_PATH=$(npm root -g) node driver.js > /tmp/opencode/driver-run.log 2>&1 < /dev/null &
```

- 프로필: `/tmp/pw-banking-ext` — **삭제 금지** (allow 권한 + 수동 설치 확장 저장됨)
- `.env`: `ID`/`PW`(로그인), `ACCOUNTS=계좌:비번,계좌:비번` (계좌 조회용)

## 3. 핵심 연구 성과

### 보안 프로그램/확장/CDP (security-program.md 상세)
- Playwright 번들 chromium은 AhnLab 연동 불가 → **시스템 Chrome 필요**
- Chrome 137+ `--load-extension` 차단 → **사용자 수동 설치 + connectOverCDP** (기존 Chrome 프로세스 제어)
- allow 모달(WebHID)은 사용자 1회 수동 → **고정 프로필에 저장**
- 4문항 상세 정리: `docs/research/login/security-program.md`

### 숫자 키패드 (계좌비밀번호)
- `계좌비밀번호_layout`(숨김) 안에 키 앵커 17개, 실제 이미지는 별도
- **키 앵커 화면 좌표 → page.screenshot({clip}) → LFM 개별 인식** → 숫자 10/10 charMap
- 키패드 구조: 중앙 3x4(숫자+아이콘 셔플) + 좌우 Enter/⌫

### 거래내역 저장 (최종 방식)
- 조회 후 `F01_wfr_grd_list_btngrp_div_btn_downFile`("파일저장") 클릭 → w2popup iframe(CO00012RP)
- iframe에서 `cbx_columnAll_input_0`(전체) 체크 → `btn_saveTxt`(텍스트 저장) → **download 이벤트**
- 파일: `신한은행_거래내역조회_*.txt` — **세미콜론 구분 서버 정리본** (거래일자;시간;적요;출금;입금;내용;잔액;거래점;CMS코드)
- 파싱 → `capture/{연도}/{월}/transactions_{계좌}.csv` + 증분 병합
  - 키: 거래일자+적요+출금+입금 → 같은 키면 갱신, 새 거래 추가, 중복 없음

## 4. run45 최종 성공 로그

```
20:36:54 조회기간 3개월 선택: true
20:36:58 숫자 charMap (10/10)
20:36:59 계좌 조회: {"success":true}
20:37:04 시작 날짜 1년 전 설정: true
20:37:05 재조회 클릭: true
20:37:13 CSV 저장: capture/2026/08/...csv (2행)
20:37:13 CSV 저장: capture/2026/07/...csv (10행)
20:37:13 CSV 저장: capture/2026/06/...csv (17행)
20:37:13 CSV 저장: capture/2026/05/...csv (8행)
20:37:13 거래내역 텍스트 저장: 4개월치
```

## 5. 다음 세션 실행 지침 (자율 진행용)

1. **재실행 검증**: 위 실행 방법대로 driver.js 실행 → 기존 CSV와 증분 병합 확인 (중복 없이 유지)
2. **다른 계좌 추가**: .env의 ACCOUNTS에 추가 → 자동으로 해당 계좌도 조회/저장
3. **대량 거래 페이징 확인**: 거래가 많은 계좌에서 텍스트 저장이 전체를 반환하는지 (페이지네이션 제한 여부)
4. **필요 시**: 조회기간 옵션(1년/전체 등) 추가, CSV 형식 조정

## 6. 관련 문서

- `docs/research/STATUS.md` (이 문서)
- 로그인: `docs/research/login/plan.md`, `transpad.md`, `keypad-recognition.md`, `security-program.md`
- 조회: `docs/research/extract/plan.md`, `account-inquiry.md`, `transaction-parsing.md`
- 코드: `driver.js` (전체 자동화), `shinhan-extractor/{login,popup,tk,transkey,vision}.js`
- 로그: `/tmp/opencode/driver-run45.log` (최신 성공)
