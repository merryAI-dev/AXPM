# AXPM 운영 연결

이 앱은 기존 Google Sheets 운영을 유지하는 운영자용 보조 콘솔이다. 기업과 멘토에게 새 앱 가입을 요구하지 않는다.

## 로컬 검증

Node 22 이상과 Java 21 이상이 필요하다.

```sh
npm ci
cp .env.example .env.local
# TOKEN_ENCRYPTION_KEY와 CRON_SECRET에는 각각 별도의 openssl rand -hex 32 결과를 설정한다.
npm run emulators
# 다른 터미널
npm run dev
```

macOS Homebrew Java를 설치했지만 기본 java가 실행되지 않으면 `JAVA_HOME=/opt/homebrew/opt/openjdk@21 npm run emulators`로 실행한다.

http://localhost:3000 의 '로컬 검증 계정으로 시작'을 사용한다. Auth·Firestore·Storage가 실제 Firebase 에뮬레이터에 연결된다. 에뮬레이터는 기본적으로 종료 시 데이터를 보존하지 않는다. 재현하려면 연결 설정에서 파일을 다시 업로드하거나 `npx tsx scripts/local-bootstrap.ts /path/to/xlsx`를 실행한다. 실데이터와 생성 보고서는 Git에 포함하지 않는다.

## Firebase 운영 프로젝트

1. 사용자가 지정한 Firebase 프로젝트에 Firestore와 Storage를 생성한다. 운영자 Google 로그인을 Firebase Authentication에서 활성화한다.
2. 웹 앱을 등록하고 `.env.example`의 `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`를 실제 값으로 설정한다. `NEXT_PUBLIC_USE_EMULATORS=false`로 바꾸고 모든 `*_EMULATOR_HOST`를 제거한다.
3. `ALLOWED_EMAILS`에 허용 운영자 이메일을 정확히 지정한다. 공개 가입자는 서버 데이터에 접근할 수 없다. 현재는 운영자 UID별 독립 작업공간이며 여러 운영자의 공동 편집 권한은 구현하지 않았다.
4. 서버는 Google Application Default Credentials를 사용한다. 로컬 운영 프로젝트 검증은 `gcloud auth application-default login`, 운영 배포는 실행 서비스 계정에 Firestore·Storage 접근 권한을 부여한다. 서비스 계정 키를 저장소에 올리지 않는다.
5. `firebase deploy --only firestore:rules,storage --project PROJECT_ID`로 클라이언트 직접 접근 차단 규칙을 배포한다. 데이터 접근은 로그인 토큰을 확인한 서버를 통해서만 이뤄진다.
6. Firebase App Hosting에서 AXPM 저장소의 Next.js 앱을 연결한다. App Hosting에는 Blaze 요금제가 필요하므로 프로젝트·비용 승인을 받은 뒤 실제 배포한다. `apphosting.yaml`의 실행 자원 설정과 환경변수를 검토한다. Cloud Run을 선호하면 포함된 Dockerfile을 사용한다.

## Google Sheets · Gmail · Calendar 동의

Google Cloud에서 Google Sheets API, Gmail API, Google Calendar API를 활성화한다. OAuth 동의 화면을 설정하고 테스트 중에는 사용 계정을 테스트 사용자로 등록한다. OAuth Web 클라이언트를 만들고 다음을 설정한다.

- 승인된 리디렉션 URI: `APP_ORIGIN/api/google/callback` (로컬 예: `http://localhost:3000/api/google/callback`)
- 서버 변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN`
- 토큰 암호화: `TOKEN_ENCRYPTION_KEY` — 32바이트 hex, Secret Manager 보관. 이 키를 잃거나 교체하면 기존 연결을 다시 승인해야 한다.

로그인한 운영자와 동일한 Google 계정을 연결한다. 앱에서 각각 권한을 승인한다.

| 연결 | OAuth 범위 | 용도 |
| --- | --- | --- |
| Sheets | spreadsheets.readonly | 지정 시트만 읽고 점검. 원본 셀 변경 기능은 현재 제공하지 않음 |
| Gmail | gmail.readonly, gmail.send | 설정된 업무 검색 범위의 메타데이터·미리보기 조회, 승인한 메일 발송 |
| Calendar | calendar.events | 연결 계정 primary 캘린더 조회, 승인한 일정 초대 |

Gmail 읽기는 제한된 OAuth 범위에 해당한다. 테스트 사용자 범위를 넘어 배포할 경우 Google의 검증 요구사항을 확인해야 한다. 회사 Workspace 정책에 따라 관리자 허용이 필요할 수 있다. 전체 멘토의 개인 캘린더를 읽을 수 있는 것은 아니다.

연결 설정에 멘토용 마스터·특화 신청·전담 신청 URL을 입력하고 저장한다. 내부 마스터는 선택이다. Sheets API에서 헤더·병합·완료 체크·취소선을 읽어 정규화한다. 읽기 범위는 각 선택 시트의 A1:AR2000이며, 이 범위를 넘는 데이터는 범위를 확장한 후 사용한다.

## 실제 에이전트

`npm run hermes:setup`으로 Hermes를 설치하고 `.env.local`에 `AGENT_ENGINE=hermes`, `AGENT_PROVIDER=gemini`, `GEMINI_API_KEY`, 계정에서 사용할 수 있는 `AGENT_MODEL`, `HERMES_BIN` 절대 경로를 설정한다. [Hermes + Gemini 안내](HERMES.md)를 참고한다. 키·모델이 없으면 실행 버튼을 비활성화하고 API는 503을 반환한다. 다른 모델이나 고정 답변으로 대체하지 않는다.

에이전트는 운영 현황·기업별 근거·업무 메일·캘린더를 선택적으로 읽고, 메일·일정·티켓 조정안을 작성하거나 보고서 초안을 저장한다. 사용자의 최근 대화 요약과 요청을 다음 대화에 전달한다. 단계별 도구 사용과 최종 보고를 Firestore에 저장한다. 실행 권한은 모델에게 주지 않는다.

## 티켓·시수

전담/특화 잔여 티켓과 잔여 시간을 각각 관리한다. 최초 값은 미설정이다. 예: “기업 A의 특화 잔여 티켓을 2회, 잔여 시간을 2시간으로 지정해줘. 사유는 추가 지원.” 에이전트가 제안하고 운영자가 승인하면 트랜잭션으로 기록한다. 이후 “특화 티켓 1회 줄여줘” 같은 증감이 가능하다.

현재 잔여량은 사용자가 확정하는 원장이다. 신청이나 경과 시간으로 자동 차감하지 않는다. 원본 스냅샷이 바뀌면 재확인 표시를 한다. 원본의 기업명+이메일이 바뀌면 식별자가 달라져 이전 티켓 연결을 검토해야 한다. 행 순서 변경만으로 식별자는 바뀌지 않는다.

## 보고서 원본 다운로드

원본 XLSX를 Storage에 비공개 저장하고 9개 필드의 셀 매핑을 Firestore에 저장한다. 기본 매핑은 C3/E3/C4/E4/C5/C6/B9/B11/B13이다. XML 패치로 지정 셀 값만 변경하고, 나머지 ZIP 항목·서식·병합·인쇄 설정·기존 사진은 유지한다. 사진 교체와 넘치는 텍스트에 대한 자동 행 높이 조정은 현재 지원하지 않는다. 원본에 예시 사진이나 추가 시트가 있으면 새 보고서에 적합한 템플릿으로 준비해야 한다.

## 정기 모니터링

`CRON_SECRET`을 32자 이상 랜덤 값으로 Secret Manager에 저장하고 운영자 설정에서 정기 점검을 허용한다. Cloud Scheduler에서 `POST APP_ORIGIN/api/cron`, `Authorization: Bearer CRON_SECRET`, JSON 본문 `{"uid":"FIREBASE_AUTH_UID"}`를 설정한다. 예: 평일 09:00, 시간대 Asia/Seoul. 비밀 헤더는 저장소에 넣지 않는다. UID는 `GET /api/state` 응답 또는 Firebase Auth 콘솔에서 확인한다.

정기 요청은 시트 동기화 후 에이전트 점검을 수행하고 운영 콘솔에 보고한다. 메일을 자동 발송하지 않는다. 대화 및 Drive 변경 작업은 Firestore 작업 큐에 저장하고 `/api/worker`가 실행한다. 멘토링 정기 점검 경로는 요청 안에서 동기화와 모델 호출을 수행한다. 운영 전 실제 모델 응답 시간에 맞춰 스케줄러·서버 타임아웃을 검증해야 한다.

## 검증

`npm test`, `npm run typecheck`, `npm run build`. 실제 엑셀을 점검하려면 `npm run import:inspect -- /path/to/xlsx`. `local-bootstrap.ts`는 실제 인증 API를 통해 파일 업로드·Firestore 저장·Storage 템플릿·보고서 다운로드를 검증한다.

## 공식 자료

- [Firebase App Hosting 시작](https://firebase.google.com/docs/app-hosting/get-started)
- [Gmail 서버 OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server)
- [Gmail OAuth 범위](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Claude 도구 호출](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)


폴더 정기 조사는 같은 `/api/cron`에 `{"uid":"FIREBASE_AUTH_UID","scope":"workspace"}`를 보낸다. 한 요청에서 파일 한 페이지를 조사하고 체크포인트를 저장한다. 완료될 때까지 다음 호출에서 이어가며, 한 차례 조사가 끝나고 모델이 설정되어 있으면 근거 확인 에이전트 작업을 큐에 넣는다. `/api/worker`가 그 작업을 실행한다. 모델이 없으면 파일 조사만 수행한다. 운영자의 정기 점검 허용 설정이 꺼져 있으면 건너뛴다. 실제 Google 연결 전에는 외부 조회를 하지 못하고 오류를 반환한다.
