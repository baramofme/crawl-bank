# 연구: 계좌 조회 (특정 계좌 목록, 조건 선택)

> 로그인 후 계좌조회 페이지에서 원하는 계좌를 조회하는 방법.
> **상태: 🔴 미탐색** — 로그인(보안 프로그램)이 아직 완료되지 않아 실제 페이지 구조를 확인 못 함.

## 연구해야 할 것

### 1. 계좌 목록 로드 (특정 계좌 목록으로 조회)

- 로그인 후 계좌조회 페이지(#210101000000)에 보이는 계좌 목록 DOM 구조
- 목록에서 특정 계좌(계좌번호) 선택하는 방법:
  - `<select>` 기반인지, 리스트/테이블 기반인지
  - 계좌 선택 시 이벤트 (change/click)
- 계좌번호 입력 필드 존재 여부 (login.js의 `accountInquiry`는 `input[placeholder*="계좌"]` 사용 — 실제 페이지와 일치하는지 확인 필요)

### 2. 조회 조건 선택

- 기간 조건: 3개월/6개월/1년 등 (`selectThreeMonths()`가 `select`에서 "3개월" option 찾는 방식)
- 기간 외 조건 (조회 구분: 전체/입금/출금 등) 있는지
- 조건 변경 시 필요한 이벤트 (change dispatch, w2ui 컴포넌트 여부)
- w2ui(`.w2selectbox_native_select`) 사용 여부 — 신한은행은 w2ui 기반이므로 네이티브 select가 아닐 수 있음

### 3. 조회 실행

- "조회" 버튼 셀렉터 (login.js는 `a, button` 순회하며 textContent "조회" 포함 + visible 확인)
- 조회 후 결과 로딩 대기 방법 (AJAX/프레임 여부)
- 계좌비밀번호 TransKey 입력 필요 여부 (login.js의 `accountInquiry`는 `transkeyInput` 사용)

## 기존 구현 (login.js, 미검증)

```js
async function goToAccountPage() {
  await chrome.tabs.update({ url: 'https://bank.shinhan.com/rib/easy/index.jsp#210101000000' });
  await new Promise(r => setTimeout(r, 2000));
}

async function accountInquiry(accountNo, accountPw) {
  // input[placeholder*="계좌"] || input[name*="account"] 에 계좌번호 입력
  // getElementById('계좌비밀번호') || input[type="password"] 에 TransKey 입력
  // a, button 중 textContent에 "조회" 포함 + offsetParent !== null 인 요소 클릭
}
```

## 확인 필요 사항 (로그인 성공 후)

1. 계좌조회 페이지 실제 DOM (wq_uuid 계열 아이디?)
2. 계좌 선택 UI 종류 (select/리스트)와 이벤트
3. 조회 버튼 정확한 셀렉터
4. 조회 결과 로딩 완료 신호
5. 계좌 목록이 "특정 계좌 목록"으로 필터링 가능한지 (사용자 요구: 특정 계좌 목록으로 조회)

## ✅ 확인된 실제 구조 (2026-08-07, 로그인 성공 후)

| 요소 | 셀렉터 | 내용 |
|------|--------|------|
| 계좌번호 select | `#sbx_accno_input_0` | "선택하세요", "110-299-717889 = 110299717889" |
| 통화코드 select | `#sbx_통화코드_input_0` | USD/JPY/CNY/EUR/GBP/CAD/CHF/HKD/SEK/AUD/DKK/NOK |
| 계좌번호 입력 | `#ibx_계좌번호` | 텍스트 입력 |
| 계좌비밀번호 | `#계좌비밀번호` | 숫자 4자리, TransKey |
| 조회기간(from/to) | `#wfr_searchCalendar_ica_fr_input`, `#wfr_searchCalendar_ica_to_input` | 달력 |
| 년/월 | `#wfr_searchCalendar_ibx_year`, `#wfr_searchCalendar_ibx_month` | |
| **조회 버튼** | `#btn_조회` | w2anchor2 btnTySky01 large |
| **파일저장 버튼** | `#wfr_grd_list_btngrp_div_btn_downFile` | 거래내역 파일 저장 (형식 미확인) |
| 결과 그리드 | `#wfr_grd_list` (w2ui grid) | 조회 결과 표시 |

- 조회 후 결과는 w2ui 그리드 → `w2ui['...'].records`로 전체 데이터 접근 가능할 것으로 예상
- "파일저장" 버튼이 있으니 CSV/엑셀 다운로드 경로도 후보
- driver.js는 `.env`의 `ACCOUNT_NO`/`ACCOUNT_PW`가 있으면 popup `#accountNo`/`#accountPw` 입력 후 `#doAccountInquiry` 클릭 → `accountInquiry()`가 조회 버튼 클릭
