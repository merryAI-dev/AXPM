# Cloud Run 배포

배포 스크립트는 Cloud Run 서비스와 선택적 정기 작업을 구성한다. 실행 전 프로젝트 결제, API, 서비스 계정, Firebase, Secret Manager 설정이 완료되어야 한다.

## 필요한 리소스

- Cloud Run, Cloud Build, Artifact Registry, Firestore, Firebase Authentication, Secret Manager
- `roles/datastore.user`와 필요한 Drive 접근 권한을 가진 런타임 서비스 계정
- Google 로그인이 활성화된 Firebase 웹 앱과 정확한 승인 도메인
- Secret Manager의 `GEMINI_API_KEY`, `CRON_SECRET`
- 관리 Drive 루트에 공유된 `GOOGLE_SERVICE_ACCOUNT_EMAIL`

서비스 계정 키 파일은 만들지 않는다. 런타임 ADC와 IAM Credentials API로 Drive와 Sheets 토큰을 발급한다.

## 배포

```sh
cp deploy/config.example.json private/deploy.json
npm run check:deployment -- private/deploy.json
npm run deploy:plan -- private/deploy.json
node scripts/deploy.mjs private/deploy.json --apply
```

`private/deploy.json`에는 프로젝트, 리전, 이미지, Firebase 공개 설정, 허용 도메인, AXPM 운영 대상을 지정한다. Gemini 키와 cron 비밀은 파일에 넣지 않고 Secret Manager 이름만 연결한다. `.gcloudignore`와 `.dockerignore`는 로컬 환경변수, 고객 문서, 개인 인증 정보를 빌드 컨텍스트에서 제외한다.

## 정기 보고서 조사

Cloud Run Job에서 `scripts/worker.mjs`를 실행하고 `AXPM_BASE_URL`, `AXPM_WORKER_UID`, `CRON_SECRET`을 주입한다. Cloud Scheduler는 해당 Job 실행 권한만 가진 별도 서비스 계정으로 호출한다. 작업 재시도는 중복 쓰기를 막기 위해 0으로 두며 Firestore 실행 잠금과 체크포인트로 다음 실행에서 이어간다.

```sh
node scripts/schedule-worker.mjs private/deploy.json
node scripts/schedule-worker.mjs private/deploy.json --apply
```

마스터 쓰기는 이벤트 식별자와 원본 버전을 함께 검증한다. 결과가 불확실한 쓰기는 자동 재실행하지 않고 작업 이력에서 확인한다.
