# Hermes 연결

Hermes는 선택적 실행기다. 앱 요청을 Hermes, Gemini, AXPM MCP 순서로 처리하며 별도 공개 에이전트 서비스를 만들지 않는다.

```sh
npm run hermes:setup
```

```dotenv
AGENT_ENGINE=hermes
AGENT_PROVIDER=gemini
AGENT_MODEL=사용할_모델_ID
GEMINI_API_KEY=비공개_API_키
HERMES_BIN=/absolute/path/to/hermes
APP_ORIGIN=https://service.example
```

Hermes 실행마다 운영자 범위의 단기 MCP 키와 격리된 임시 디렉터리를 만들고 종료 뒤 폐기한다. Gemini 키는 서버 프로세스에만 주입한다. `APP_ORIGIN`은 Hermes가 `/api/mcp`에 접근할 수 있는 HTTPS 주소여야 한다.

제공되는 업무는 다음 범위로 제한된다.

- 사업관리 마스터 현황 조회
- 기업, 회차, 완료일, 멘토, 근거가 확인된 멘토링 기록
- 관리 Drive 폴더와 보고서 조사
- 보고서 파일명 표준화 미리보기와 실행
- Gmail 첨부 수집 상태 조회와 요청 시 Drive 수집

마스터 기록은 먼저 변경 셀과 `planHash`를 만든 뒤 같은 계획으로 실행한다. 서버가 원본 버전, 기업 매칭, 중복, 쓰기 영수증을 검사하며 재조회 결과가 확인된 경우에만 완료로 기록한다. 보고서 탭 삭제나 필수값 제거는 자동 기록한 셀만 원복하는 승인 제안으로 전환한다.

정기 조사 키는 조회 권한만 가진다. 외부 MCP 클라이언트에는 앱에서 발급한 제한 키를 사용하며 키를 문서나 저장소에 남기지 않는다.

공식 자료: [Gemini 제공자](https://hermes-agent.nousresearch.com/docs/integrations/providers), [MCP 연결](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).
