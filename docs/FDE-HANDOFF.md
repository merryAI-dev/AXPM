# FDE 인수인계

이 저장소는 운영자 개인 환경이 아니라, 고객 환경에 연결·수정·납품할 수 있는 AXPM 구현과 Hermes 소스의 인수인계 단위다. 배포는 이번 범위에서 제외했다.

## 포함된 작업

| 경로 | 내용 |
| --- | --- |
| `src/app` | 운영 현황, 에이전트 대화, Drive 탐색, 실제 셀 편집, 승인 화면 |
| `src/lib/hermes-runtime.ts` | Hermes + Gemini 실행, 실행별 격리, 대화 전달, 결과 저장, 임시 키 폐기 |
| `src/lib/mcp-http.ts`, `mcp-tools.ts`, `bridge.ts` | 인증된 HTTP/stdio MCP, 13개 도구, 사용자 격리, 조회 전용 정기 실행 |
| `src/lib/workspace` | 폴더 범위 검사, XLSX/Sheets 셀 매핑, 버전 충돌, 백업, 승인 작업 큐, 인덱스 |
| `vendor/hermes-agent` | Hermes 공식 리비전의 실제 소스 전체, 원본 문서·테스트·라이선스 |
| `vendor/hermes-source.json` | 출처, 고정 리비전, 원본 압축 파일의 SHA-256 |
| `.claude/skills` | 멘토링 점검·보고서·티켓·폴더 관리 업무 스킬 |
| `scripts`, `tests` | 설치, 키 복원, 실제 API/MCP 검증, 합성 데이터 회귀 테스트 |
| `Dockerfile`, `deploy` | 후속 배포용 코드와 설정 예시. 운영 배포 완료를 의미하지 않음 |

Hermes는 서브모듈 링크나 설치 안내만 넣은 것이 아니라 소스 파일을 이 저장소에 직접 포함했다. 설치 스크립트는 이 소스를 사용한다. AXPM 수정은 일반 소스에서, Hermes 자체 수정은 `vendor/hermes-agent`에서 진행할 수 있다. 최초 반입 시 upstream 소스는 변경하지 않았다. 이후 자체 수정은 AXPM의 Git 이력으로 관리하고 출처 정보에 변경 여부를 기록한다.

인증 키·OAuth 토큰·실제 기업 데이터·원본 업무 XLSX·개인 실행 이력·생성 보고서는 공개 저장소에 포함하지 않는다. Node/Python 의존성 캐시와 가상환경도 재설치 대상이다. 원본 업무 데이터는 고객의 Drive/Sheets에 연결하거나 XLSX로 입력한다.

## 재현

Node 22+, Java 21+, uv와 Python 3.13을 준비한다.

```sh
npm ci
cp .env.example .env.local
# 환경별 설정과 암호화/작업 인증 키: docs/SETUP.md
npm run emulators
# 다른 터미널
npm run dev
# 다른 터미널
npm run hermes:setup
npm run gemini:connect -- PROJECT_ID KEY_ID GEMINI_MODEL_ID
npm run check:mcp
npm run check:hermes -- --live
```

Gemini 키를 직접 공급할 수도 있다. `.env.local`의 `GEMINI_API_KEY`, `AGENT_MODEL`을 설정하면 된다. 설치 스크립트가 `HERMES_BIN`을 지정한다. 가상환경은 `private/hermes-venv`, 실행 설정은 `private/hermes`에 생성한다. 외부 에이전트는 `http://localhost:3000/api/mcp`, API 요청은 `npm run agent:ask -- '요청 내용'`을 사용한다.

Drive 서비스 계정 방식은 `.env.local`에 실행 계정 이메일과 관리 루트를 설정하고 해당 폴더를 공유한다. 로컬 gcloud 토큰 사용은 Firebase 에뮬레이터에서만 허용한다. Gmail/Calendar는 별도의 사용자 OAuth 동의와 앱 승인이 필요하다.

## 실제로 검증한 범위

- Drive의 별도 합성 폴더에서 생성·복사·이름 변경·휴지통·복원, XLSX와 native Sheets의 실제 셀 편집과 재조회.
- 실제 네 개 운영 시트 동기화, 원본 보고서 양식의 셀 기반 편집·다운로드와 다른 ZIP 항목 보존.
- API → Hermes → Gemini → HTTP MCP → 합성 XLSX의 C3/B11 조회 → 최종 답변.
- 22개 AXPM 단위 테스트, Firebase 에뮬레이터 통합 테스트, 브라우저 검증, Next production build.

Hermes upstream 전체 테스트를 실행한 것은 아니다. 고객별 인정 횟수·시수·정산 규칙과 권한 정책은 업무 스킬과 서버 검증으로 적용해야 한다. 현재 정산 기능은 후속 확장 범위다.

GCP 프로젝트·Firestore·Firebase Web App·서비스 계정·Gemini 전용 인증 키는 준비한 이력이 있다. Cloud Run은 배포하지 않았다. 컨테이너 검증 중 발견한 설치 방식은 수정했으며, 사용자 요청에 따라 배포 작업을 중단했다. 후속 배포 담당자는 실제 고객 프로젝트의 결제·Secret Manager·Auth·스토리지 설정과 컨테이너 검증을 이어서 수행한다.
