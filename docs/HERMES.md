# Hermes + Gemini · API / MCP

기본 실행 엔진은 Hermes, 모델 제공자는 Gemini다. Qwen/Ollama 실행 경로와 프로젝트 모델 별칭은 제거했다. Gemini 키나 모델이 없으면 API는 503을 반환하며 다른 모델로 대체하지 않는다.

## 로컬 실행

Node 22+, uv, Python 3.13, 실행 중인 Firebase 에뮬레이터와 AXPM 서버가 필요하다.

```sh
npm run hermes:setup
# .env.local에 GEMINI_API_KEY, AGENT_MODEL을 설정한다.
# HERMES_BIN은 private/tools/hermes-agent/.venv/bin/hermes의 절대 경로다.
npm run agent:ask -- '미신청 후보를 원본 근거로 점검해줘'
npm run hermes -- chat -q '사업 공유 폴더의 현재 조사 상태를 알려줘'
npm run check:mcp
```

설치 스크립트는 공식 Hermes 리비전 `3c3ab69abb9b08683b5eb15b4e2b8be1198c875f`를 `private/tools`에 설치한다. CLI 설정은 `private/hermes`, API 키는 `.env.local`, 24시간짜리 AXPM 연결 키는 `private/agent-runtime.json`에 보관한다. 모두 Git 제외 대상이다. `npm run agent:setup`으로 연결 키를 갱신한다. 전역 Hermes 설정을 덮어쓰지 않는다.

`POST /api/bridge`에 Bearer 연결 키와 아래 JSON을 보내면 웹 UI와 같은 Hermes 엔진을 호출한다. 실행 권한을 선택하여 발급한 키만 `agent` 연산을 사용할 수 있다.

```json
{"operation":"agent","input":{"goal":"전담·특화 현황을 각각 확인해줘"}}
```

서버는 실행별 임시 Hermes 디렉터리와 사용자별 MCP 키를 만들고, 최근 대화·4개 업무 스킬을 전달한다. Hermes가 Gemini와 대화하면서 AXPM 도구를 사용한다. 완료/실패는 Firestore에 기록하고 임시 파일과 연결 키를 폐기한다. 정기 실행의 MCP 키는 조회 전용이다. 메일 발송·일정 초대·티켓 확정·Drive 쓰기는 별도 운영자 승인 화면에서 처리한다.

## MCP

표준 Streamable HTTP 엔드포인트: `http://localhost:3000/api/mcp`. 인증 없는 요청과 다른 웹 출처는 거부한다. 기존 `scripts/mcp-server.ts` stdio 연결도 지원한다.

```yaml
mcp_servers:
  axpm:
    url: http://localhost:3000/api/mcp
    headers:
      Authorization: 'Bearer ${AXPM_BRIDGE_KEY}'
    timeout: 120
```

13개 도구: 현황, 기업 상세, 업무 메일, 일정, 변경 제안, 보고서 초안, 폴더 상태, Drive 목록, 인덱스 검색, Drive 셀 조회, Drive 변경 제안, 업로드 파일 목록, 업로드 셀 조회. 승인·실행 도구는 노출하지 않는다. 현황의 기업 목록은 10개씩 `query`/`offset`으로 조회한다. 집계는 전체 스냅샷 기준이며 부분 목록임을 응답에 표시한다.

Hermes CLI의 AXPM 도구셋 이름은 `axpm`이다. `.claude/skills`의 4개 업무 스킬을 설치 스크립트가 복사하며 API 실행은 저장소의 최신 스킬을 매번 읽는다. 서버의 권한·승인 규칙은 스킬 문구로 해제할 수 없다.

## 클라우드

Dockerfile은 Node 앱과 동일한 리비전의 Hermes/Python 런타임을 함께 설치한다. Cloud Run 환경에 `AGENT_ENGINE=hermes`, `AGENT_PROVIDER=gemini`, 실제 `AGENT_MODEL`을 지정하고 `GEMINI_API_KEY`는 Secret Manager로 주입한다. API 서버가 MCP 콜백을 받을 수 있도록 `APP_ORIGIN`을 실제 서비스 URL로 지정한다.

2026-09-16 로컬에서 Gemini 전용 인증 키와 `gemini-3.8-flash`를 연결했다. 합성 XLSX를 사용해 API → Hermes → Gemini → HTTP MCP → Firebase 셀 조회 → 최종 응답을 실제로 검증했다. Cloud Run 배포는 결제 계정 연결이 남아 있으며 아직 완료하지 않았다.

참고: [Hermes Gemini 제공자](https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers/), [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

## 컴퓨터 교체 시 키 복원

프로젝트 권한이 있는 gcloud 계정으로 로그인하고, 기존 Gemini 전용 인증 키를 복원한다. 키 값을 채팅이나 Git으로 전달할 필요가 없다.

```sh
npm run gemini:connect -- PROJECT_ID KEY_ID GEMINI_MODEL_ID
npm run hermes:setup
npm run check:mcp
npm run check:hermes -- --live
```

복원 스크립트는 실제 Gemini 모델 조회가 성공한 뒤 `.env.local`에만 키를 기록한다. 설치 스크립트는 `HERMES_BIN`을 자동으로 설정하고, 환경에 Drive 루트가 지정돼 있으면 최초 로컬 운영자 설정에 반영한다. `check:hermes --live`는 Gemini를 실호출하므로 연결 계정의 사용량을 소비한다. 테스트 전용 사용자와 합성 엑셀을 만들고 끝난 뒤 정리한다.
