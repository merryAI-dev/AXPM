# 검증 기록

2026-09-16, macOS / Node 24 / Java 21 / Firebase 로컬 에뮬레이터.

## 수행한 검증

- 단위 테스트: 완료 체크 재집계, 보고서 누락, 취소선, 병합 날짜, 캠퍼스별 열 차이, 병합 기업 아래 행 실적, 파일 메타데이터와 데이터 변경 구분.
- 보고서: 9개 필드가 지정 셀에 들어가고 병합·스타일이 유지됨. 잘못된 병합 하위 셀과 중복 매핑은 거부.
- 사용자 제공 원본 XLSX와 실제 인증 API 다운로드 결과 비교: `xl/worksheets/sheet1.xml`만 변경, 나머지 17개 ZIP 항목의 내용이 바이트 단위로 일치. 결과를 openpyxl로 다시 열어 지정 셀 값 확인.
- Firebase: Auth 로그인, 다른 사용자 데이터 분리, Firestore 클라이언트 직접 읽기 거부, Storage 템플릿 저장·다운로드.
- 티켓: 기준 미설정, 음수, 횟수/시간 분리, 동시 승인 시 1회만 반영, 다른 사용자 승인 차단.
- MCP: stdio 클라이언트로 6개 도구 탐색, 현황 조회와 티켓 제안 호출. MCP 키로 승인 API 접근 불가, 키 폐기 후 접근 차단.
- 화면: Chrome headless에서 운영 현황·기업·일정·승인·보고서·설정 탭 이동. 브라우저 런타임 오류 없음. 모바일 390px 가로 넘침 없음.
- TypeScript 검사 및 Next.js production build.

실제 데이터·스크린샷·생성 엑셀은 Git에 포함하지 않는다. `scripts/local-bootstrap.ts`와 `scripts/integration-check.ts`로 재현한다. 실제 파일 검증용 다운로드에는 검증용 문구를 채우므로 실제 사업 보고서로 사용하면 안 된다.

## 아직 실제 연결로 검증하지 않은 항목

- 운영 Firebase 배포와 Google OAuth 동의 화면.
- 실제 Sheets API 동기화, Gmail/Calendar 읽기·발송·초대.
- 모델 API를 통한 추론 품질과 장시간 호출, Hermes 런타임에서의 전체 대화.
- Cloud Scheduler 정기 실행.

이 항목은 프로젝트·시트 URL·API 계정 연결 후 검증한다. 코드 경로와 MCP 연결 검증이 실제 서비스 연결 검증을 대신하지 않는다.
