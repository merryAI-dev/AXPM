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

## 2026-09-16 · Folder workspace implementation, connections deferred

Verified after the workspace/editor/job changes:

- 17 unit tests pass, covering source ZIP member preservation, arbitrary field mapping, formulas, merged children, stale versions, Drive ancestry restrictions, changed-cell-only native adapter writes, lifecycle operations, publication and nonexecuting deployment plans.
- Firebase emulator integration passes: real XLSX upload/read/save/download, concurrent save rejection, authenticated routes, two-account isolation, 13 MCP tools without approval/execution capabilities, idempotent proposals, concurrent approval and execution claims, uncertain results held without replay, expired leases including write fencing, resumable index and root-change isolation.
- Desktop/mobile Chromium smoke test passes using the actual user-supplied report template: 9 fields read, one synthetic discussion cell edited, diff reviewed, save/download verified, job center navigation, no page exceptions or horizontal mobile overflow. The synthetic uploaded test copy is removed afterward.
- Downloaded real-template archive has exactly the original 18 member names. Only `xl/worksheets/sheet1.xml` changed; the other 17 file payloads are byte-identical. Original Downloads file is untouched. Output and screenshots remain in ignored `private/validation`.
- TypeScript and Next production build pass. Deployment plan scripts run in tests with no gcloud available, verifying that default plan mode does not connect or execute cloud commands.

Google OAuth/Gmail/Drive live calls, native Google Sheets live writes, a live Anthropic/Hermes reasoning run and Cloud Run deployment were not executed in this round. Drive provider contract tests use an explicitly injected in-memory port; production has no automatic fake-data fallback. The local Firebase console is not a deployed production service.

## 2026-09-16 · 실제 Drive/Sheets 연결, Hermes + Gemini 전환

- 공유된 루트를 런타임 서비스 계정으로 실제 조회했다. 개인 키 파일 없이 gcloud/ADC → IAM Credentials 토큰으로 Drive/Sheets에 접근한다.
- 별도 합성 폴더에서 실제 생성, XLSX 게시·다운로드, B11 편집, 복사·이름 변경·휴지통·복원, native Sheets B11 편집을 검증했다. 수식·기업명·다른 시트 보존, 실행 전 백업과 승인 대기 차단을 확인했다. 테스트 폴더는 휴지통으로 정리했고 기존 업무 파일은 변경하지 않았다.
- 실제 네 개 운영 시트를 인증 API로 동기화했다: 기업 87개, 일정 307개. Google Sheets 탭 이름에 `/`가 있는 경우의 XLSX 변환 오류를 수정했고 원본 탭 이름을 근거에 보존한다.
- 공유 폴더 하위 인덱스 조사 완료. 인덱스는 조사 시점의 메타데이터이며 파일 본문 전체를 읽었다는 의미가 아니다.
- HTTP MCP 표준 클라이언트 초기화·13개 도구 조회·Firestore 현황 조회·미인증 거부·다른 Origin 거부·정기 점검 키의 변경/모델 실행 거부를 검증했다. 기존 stdio/승인/사용자 분리 통합 검사도 통과했다.
- Hermes 0.21.3을 고정된 공식 리비전으로 로컬 설치했다. AXPM MCP 서버 등록 확인. Gemini를 기본 제공자로 설정하고 CLI와 웹/API 실행 경로를 연결했다. 실행별 임시 디렉터리·사용자별 MCP 키·키 폐기·읽기 전용 정기 실행을 구현했다.
- 앞서 로컬 모델로 도구 호출/최종 답변을 검증했으나, 사용자 요청에 따라 해당 모델 실행 경로와 프로젝트 모델 별칭을 제거했다. 이 결과를 Gemini 검증으로 간주하지 않는다. Gemini 키·모델 미설정 상태에서는 API가 503으로 연결 필요를 반환한다.
- 단위 테스트 22개, TypeScript 검사, Next production build 통과. Drive 버전이 읽는 동안 바뀌는 경우 읽기만 제한적으로 재시도하며 쓰기는 재실행하지 않는 회귀 테스트를 포함한다.

운영 GCP 프로젝트, Firestore 데이터베이스, Firebase Web App, 런타임 서비스 계정은 생성했다. Cloud Run/정기 실행은 결제 계정 선택과 연결이 남아 있으며 아직 배포하지 않았다. Gemini 실호출은 API 키·모델 지정 후 검증해야 한다. Gmail/Calendar 사용자 OAuth는 연결되지 않았다.

Hermes 자체의 `mcp test axpm`도 실제 HTTP 연결과 13개 도구 탐색에 성공했다. Gemini 모델 응답을 시험한 것은 아니다. 컨테이너 빌드는 외부 레지스트리 ghcr.io TLS handshake timeout으로 첫 시도가 실패했으며 Next production build 성공과 구분한다.


## 2026-09-16 · Gemini 실호출 완료

GCP 프로젝트에서 Generative Language/API Keys API를 활성화하고, 별도 Gemini 실행 계정에 바인딩된 Gemini 전용 인증 키를 발급했다. 키 값은 출력하거나 Git에 넣지 않았다. 실제 모델 목록과 Hermes의 Gemini 응답을 확인했다.

`npx tsx scripts/check-hermes.ts --live` 통과: 별도 Firebase 테스트 계정으로 합성 XLSX 업로드 → `/api/bridge` 호출 → Hermes + `gemini-3.8-flash` → HTTP MCP 목록/시트/셀 조회 → C3=`합성기업`, B11=`기존 논의` 최종 답변. 실제 MCP 응답 4개를 확인했고 변경 제안이 생성되지 않았음을 검사했다. 테스트 사용자·데이터·연결 키는 정리했다. 앞 절의 Gemini 미연결 상태는 이 검증으로 해소됐다. Cloud Run 배포와 Gmail/Calendar OAuth는 여전히 미완료다.
