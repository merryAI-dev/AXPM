# 운영 설정

## Firebase

1. Firestore와 Firebase Authentication을 활성화한다.
2. Google 로그인을 켜고 실제 서비스 도메인을 승인 도메인에 추가한다.
3. Firebase 웹 앱 값을 `NEXT_PUBLIC_FIREBASE_*` 환경변수로 설정한다.
4. 서버 런타임 서비스 계정에 Firestore 접근 권한을 부여한다.
5. `ALLOWED_DOMAINS=mysc.co.kr`처럼 허용 회사 도메인을 설정한다. 개별 예외만 필요하면 `ALLOWED_EMAILS`를 사용한다.

모든 업무 API는 Firebase ID 토큰과 서버 접근 정책을 다시 검사한다.

## Google Drive와 Sheets

Drive API, Sheets API, IAM Service Account Credentials API를 활성화한다. `GOOGLE_SERVICE_ACCOUNT_EMAIL`의 서비스 계정에 자체 토큰 생성 권한을 부여하고 관리 루트를 해당 계정에 공유한다. 개인 OAuth 토큰이나 서비스 계정 키 파일은 사용하지 않는다.

다음 AXPM 환경변수로 대상만 교체할 수 있다.

- `AXPM_PROGRAM_NAME`
- `AXPM_MASTER_SPREADSHEET_ID`
- `AXPM_MASTER_SHEET_ID`
- `AXPM_MASTER_SHEET_TITLE`
- `AXPM_MASTER_DASHBOARD_RANGE`
- `AXPM_DRIVE_ROOT_ID`
- `AXPM_REPORT_FOLDER_ID`
- `AXPM_DEFAULT_CAMPUS`
- `AXPM_GMAIL_QUERY` (기본값: `label:AXPM/첨부수집 has:attachment newer_than:30d`)

마스터와 보고서 폴더는 런타임 서비스 계정에 공유되어 있어야 한다. 서버 시작 시 값의 형식을 검사하며 누락된 설정은 자동 대체하지 않는다.

## Gmail 첨부 수집

Google Cloud에서 웹 OAuth 클라이언트를 만들고 승인된 리디렉션 URI에 `APP_ORIGIN/api/mail/oauth/callback`을 등록한다. `GOOGLE_OAUTH_CLIENT_ID`는 일반 환경변수로, `GOOGLE_OAUTH_CLIENT_SECRET`과 32바이트 base64 값인 `OAUTH_TOKEN_ENCRYPTION_KEY`는 Secret Manager에서 주입한다. `AXPM_GMAIL_ACCOUNT`로 수집 전용 계정을 제한한다. 조직 전체 위임은 사용하지 않는다. 운영자가 플랫폼의 **내 Google 계정 연동하기**를 눌러 해당 계정의 `gmail.readonly` 범위에 직접 동의한다.

OAuth 클라이언트를 새로 만들지 않고 Firebase Google 로그인이 쓰는 웹 클라이언트를 재사용할 수 있다. 아래 명령은 클라이언트 ID만 출력하고 비밀값은 화면에 출력하지 않는다.

```sh
PROJECT=axpm-mysc-20260916
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: $PROJECT" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/defaultSupportedIdpConfigs/google.com" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["clientId"]); print("secret:", "present" if d.get("clientSecret") else "missing")'

# 암호화 키 (로컬과 배포는 서로 다른 값을 사용한다)
openssl rand -base64 32
```

`clientSecret`은 `.env.local` 또는 Secret Manager에 직접 저장하고 채팅·Git·로그에 남기지 않는다. 기존 OAuth 클라이언트의 리디렉션 URI 추가는 gcloud로 할 수 없으므로 Google Cloud 콘솔의 사용자 인증 정보 화면에서 등록한다.

플랫폼은 `AXPM_GMAIL_QUERY`에 맞는 최근 메시지를 최대 25개씩 확인한다. 허용된 첨부(`xlsx`, `pdf`, `docx`, `hwp`, `hwpx`)만 관리 폴더 아래 `[AXPM] 메일 첨부 수집함`에 저장한다. 메시지 ID와 첨부 ID로 중복을 막고, XLSX 보고서만 본문 기업·캠퍼스와 마스터를 대조해 표준 파일명으로 변경한다. 모호하거나 같은 표준 이름이 이미 있는 파일은 원본 이름으로 보관하고 검토 대상으로 표시한다.

서버는 메일 본문을 저장하지 않는다. Google 갱신·액세스 토큰은 AES-256-GCM으로 암호화해 사용자 연결 문서에 보관하며 화면의 연결 해제로 Google 토큰 폐기와 저장 문서 삭제를 함께 수행한다. 자동 실행은 Cloud Scheduler에서 `/api/cron`에 `{"uid":"운영_UID","scope":"mail"}`을 보내도록 구성한다.

## Gemini

`GEMINI_API_KEY`는 Secret Manager에서 런타임 비밀로 주입한다. `AGENT_ENGINE=builtin`, `AGENT_PROVIDER=gemini`, `AGENT_MODEL`을 설정하면 앱 서버가 Gemini 도구 호출을 직접 수행한다. 키가 없거나 호출이 실패하면 고정 답변을 반환하지 않고 실패 이력을 남긴다.

Hermes가 필요한 환경만 [HERMES.md](HERMES.md)의 별도 런타임을 사용한다.

## 자동 조사

`CRON_SECRET`은 32자 이상의 임의 값으로 저장한다. Cloud Scheduler 또는 Cloud Run Job이 인증된 운영자 UID로 `/api/cron`과 `/api/worker`를 호출한다. 보고서 조사는 페이지별 체크포인트를 저장하고 최근 변경 파일과 재시도 대상부터 처리한다.

## 검증

```sh
npm run typecheck
npm test
npm run build
npm run check:deployment -- private/deploy.json
```

운영 배포 전 허용 도메인 로그인, 마스터 읽기, 관리 폴더 조사, 보고서 반영, 삭제·필드 제거 원복 승인을 실제 공유 대상에서 확인한다.
