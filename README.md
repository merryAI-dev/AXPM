# AXPM · 멘토링 운영 에이전트

기존 Google 스프레드시트를 유지하면서 전담·특화 멘토링의 신청, 진행 횟수, 보고서 누락을 점검하는 운영자용 보조 시스템.

기업과 멘토는 기존 시트에서 계속 신청·기록한다. 운영자는 에이전트와 대화하고, 제안을 승인하고, 원본 엑셀 양식의 보고서를 다운로드한다.

## 구현된 기능

- Sheets API 읽기 및 기존 XLSX 가져오기. 캠퍼스별 헤더, 병합 날짜, 병합 기업의 추가 실적과 취소선을 처리한다.
- 전담·특화 구분, 진행 횟수 재집계, 미신청 후보·보고서 누락·일정 확인사항 표시.
- Firebase Auth, Firestore 업무 상태·대화·승인 이력, Storage 원본 템플릿 저장.
- 실제 Claude 도구 호출 루프. 업무 스킬을 읽어 조사·질문·후속조치 제안·보고서 초안 작성을 수행한다.
- Hermes/Claude용 MCP 서버. 같은 조회·제안 도구를 제공하며 실행 권한은 운영자 승인 화면에 둔다.
- 전담·특화 잔여 티켓과 시간을 대화로 지정·증감. 승인 시 이전·이후 기록을 남기고 중복 승인을 차단한다.
- Gmail/Calendar를 각각 Google OAuth 동의 후 연결. 업무 메일 조회, 승인한 메일 발송·일정 초대.
- 보고서의 9개 필드를 C3/E3/C4/E4/C5/C6/B9/B11/B13에 매핑. 원본 XLSX의 해당 셀만 교체해 다운로드.

## 실행

```sh
npm ci
cp .env.example .env.local
npm run emulators
# 다른 터미널
npm run dev
```

http://localhost:3000 에서 로컬 검증 계정으로 시작한다. Node 22+, Java 21+가 필요하다. 암호화 키와 연결 설정은 [설치·운영 안내](docs/SETUP.md)를 따른다.

## 연결 상태와 범위

Firebase 에뮬레이터에서 실제 파일 가져오기·저장·보고서 다운로드를 검증했다. 운영 Firebase 프로젝트, 원본 Google 시트 URL, Google OAuth 동의 및 모델 API 키는 운영 환경에 맞게 별도 연결해야 한다. 키가 없을 때 AI 응답을 흉내 내지 않는다.

원본 시트 쓰기는 구현하지 않았다. 잔여 티켓은 사용자가 확정하는 별도 원장이며 신청만으로 자동 차감하지 않는다. 특화 완료 표시는 시간 단위 시수와 다르다. 기존 템플릿 사진과 인쇄 서식은 그대로 유지되며 사진 교체·자동 행 높이 조정은 지원하지 않는다. 정산 기능은 후속 확장 범위다.

## 문서와 검증

- [Firebase·Google·정기 점검 설정](docs/SETUP.md)
- [Hermes MCP와 Claude 스킬](docs/HERMES.md)
- [검증 결과와 한계](docs/VALIDATION.md)
- 업무 스킬: [.claude/skills](.claude/skills)

```sh
npm test
npm run typecheck
npm run build
# 로컬 에뮬레이터와 앱 실행 후
npx tsx scripts/integration-check.ts
```

공개 저장소에는 코드·스킬·비식별 테스트만 커밋한다. 원본 파일, OAuth/API 비밀, 생성 보고서와 실제 데이터는 제외한다. 작은 작업 단위로 커밋·푸시한다.

## 폴더 관리 · 보고서 편집

`파일 · 보고서 편집`에서 Google 연결 전에도 XLSX를 업로드하여 실제 셀을 읽고, 매핑을 수정하고, 변경 전후를 검토한 뒤 원본 양식으로 다운로드할 수 있습니다. Drive 연결 이후에는 관리 폴더 탐색, 조사/검색, 파일 복사·이름 변경·휴지통·복원, XLSX 게시와 Google Sheets 셀 변경을 사용할 수 있습니다. 외부 변경은 `작업 센터`에서 승인 후 실행합니다.

[설계와 지원 범위](docs/WORKSPACE-ARCHITECTURE.md), [클라우드 배포 코드](deploy/README.md)를 참고하세요. 이번 작업에서는 Google 재연결과 클라우드 배포를 실행하지 않았습니다.

검증: `npm test`, `npm run typecheck`, `npm run build`. 로컬 Firebase와 개발 서버가 실행 중이면 `npm run check:integration`. 실제 제공된 보고서 양식의 브라우저 검증은 `npx tsx scripts/workspace-browser-check.ts`이며 Downloads의 원본을 찾아 업로드 사본만 수정하고 검사 후 해당 사본을 제거합니다. 결과 파일은 Git 제외된 `private/validation`에 보관합니다.
