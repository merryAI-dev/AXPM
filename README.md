# AXPM · 멘토링 운영 에이전트

기존 Google Drive와 Google Sheets를 유지하면서 멘토링 보고서와 사업관리 마스터를 자동으로 연결하는 운영 도구다.

## 제품 범위

- 사업관리 마스터의 KPI, 진행 회차, 보고서 미기입 현황을 홈에서 조회한다.
- 관리 Drive 폴더의 최근 변경과 보고서 파일 구조를 조사한다.
- 멘토가 정해진 회차 탭을 완성하면 일자와 필수 항목을 검증하고 마스터에 반영한다.
- 자동 반영한 탭이 삭제되거나 필수 항목이 사라지면 원복 제안을 만든다. 운영자 승인 뒤 자동 기록한 셀만 되돌린다.
- 파일명 표준화안을 미리 보여주고 선택한 변경만 실행한다.
- Gemini 에이전트가 같은 조회·기록 도구를 API와 MCP로 반복 실행한다.
- 모든 자동 조사, 반영, 승인, 실패를 작업 이력에 기록한다.

## 실행

Node.js 22 이상이 필요하다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

로컬 주소는 `http://localhost:3000`이다. Firebase Google 로그인 뒤 `ALLOWED_DOMAINS` 또는 `ALLOWED_EMAILS`에 등록된 계정만 업무 API를 사용할 수 있다.

## 운영 설정

Firebase, Drive 서비스 계정, Gemini 키, 마스터 시트와 관리 폴더 값은 환경변수로 주입한다. 실제 키와 고객 문서는 저장소나 이미지에 포함하지 않는다. 설정 항목은 [.env.example](.env.example), 운영 절차는 [docs/SETUP.md](docs/SETUP.md), 배포 절차는 [deploy/README.md](deploy/README.md)를 따른다.

```sh
npm run typecheck
npm test
npm run build
```

테스트 코드는 배포 이미지의 실행 경로에 연결되지 않는다. 운영 API에는 합성 데이터, 데모 로그인, 고정 응답 대체 경로가 없다.

## 관련 문서

- [제품 업데이트 및 인수인계 안내](docs/PRODUCT-HANDOFF.md)
- [멘토링 자동 반영](docs/MENTORING-AUTOMATION.md)
- [보고서 감시](docs/AUTOMATIC-REPORT-MONITOR.md)
- [Gemini API](docs/GEMINI-API.md)
- [선택적 Hermes 연결](docs/HERMES.md)
- [Drive 워크스페이스](docs/WORKSPACE-ARCHITECTURE.md)
