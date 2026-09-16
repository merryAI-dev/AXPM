# Hermes / Claude 연결

AXPM은 내장 Claude 도구 호출 루프와 별도로 stdio MCP 서버를 제공한다. Hermes 또는 Claude Code가 판단을 맡고, AXPM은 시트 읽기·집계·제안 저장·사람의 승인을 담당한다. 모델 API 키는 해당 에이전트에 나중에 설정할 수 있다.

## 연결

AXPM 운영 콘솔의 연결 설정에서 'MCP 연결 키 발급'을 눌러 24시간 유효한 키를 발급한다. 키는 조회·초안·제안 권한만 있으며 승인·발송·티켓 확정 API에는 사용할 수 없다. 키를 `AXPM_BRIDGE_KEY` 환경변수에 저장한다. 저장소에는 넣지 않는다.

Hermes의 `~/.hermes/config.yaml`에 다음 항목을 추가한다. 기존 설정은 유지한다.

```yaml
mcp_servers:
  axpm:
    command: /absolute/path/to/AXPM/node_modules/.bin/tsx
    args:
      - /absolute/path/to/AXPM/scripts/mcp-server.ts
    env:
      AXPM_BASE_URL: http://localhost:3000
    timeout: 120
```

Hermes 프로세스가 `AXPM_BRIDGE_KEY`를 상속받도록 환경을 설정한다. 원격 AXPM URL은 HTTPS를 사용한다. Claude Code도 동일한 command/args/env를 MCP 서버 설정에 추가한다.

이 저장소의 `.claude/skills/axpm-monitor`, `axpm-report`, `axpm-tickets`는 Claude Code에서 프로젝트 스킬로 사용할 수 있다. Hermes에서는 필요한 폴더를 `~/.hermes/skills/` 아래에 복사한다. 업무 규칙 수정은 저장소 스킬을 기준으로 커밋하고 Hermes 사본에 반영한다.

내장 Claude 에이전트도 매 실행 시 이 3개 SKILL.md를 읽는다. 수정된 지침은 다음 실행부터 적용된다. 수량 검증·승인·권한 같은 서버의 규칙은 스킬 문구만으로 해제되지 않는다.

## 도구

| 도구 | 역할 |
| --- | --- |
| axpm_overview | 현재 시트·누락·미신청 후보·잔여 티켓 |
| axpm_company | 기업 상세와 원본 셀 근거 |
| axpm_work_mail | 승인된 Gmail 범위에서 메타데이터·미리보기 조회 |
| axpm_calendar | 연결 계정의 일정·겹침 확인 |
| axpm_propose | 메일·캘린더·티켓 변경 제안, 실행은 콘솔 승인 |
| axpm_report_draft | 9개 필드 보고서 초안 저장 |

MCP 도구의 접두사는 클라이언트에 따라 표시가 달라질 수 있다. 키 만료 시 콘솔에서 새 키를 발급하고 에이전트 프로세스를 다시 실행한다. 'MCP 연결 키 전체 폐기'로 즉시 차단할 수 있다.

참고: [Hermes 공식 MCP 설정](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [공식 SDK stdio 서버](https://ts.sdk.modelcontextprotocol.io/server).

폴더 관리 확장 도구:

- `axpm_inspect_workspace`, `axpm_list_drive_files`, `axpm_search_drive_index`
- `axpm_read_drive_cells`, `axpm_propose_drive_change`
- `axpm_list_uploaded_workbooks`, `axpm_read_uploaded_cells`

`.claude/skills/axpm-workspace/SKILL.md`도 Hermes의 업무 스킬로 등록할 수 있습니다. 업로드 파일 조회는 Google OAuth 없이 작동합니다. Drive 도구는 별도의 실제 권한 동의가 필요합니다. 변경 제안은 항상 운영 콘솔의 작업 센터에서 승인하며 MCP 키로 승인하거나 실행할 수 없습니다.
