import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceTools, workspaceDescriptions } from "./workspace/agent-tools";
export function registerMcpTools(
  server: McpServer,
  call: (
    operation: string,
    input?: unknown,
  ) => Promise<{ content: { type: "text"; text: string }[]; isError: boolean }>,
) {
  server.registerTool(
    "axpm_overview",
    {
      description:
        "최신 시트의 전담·특화 현황, 미신청 후보, 셀 근거와 승인 대기를 조회합니다.",
      inputSchema: {
        query: z.string().max(100).optional(),
        offset: z.number().int().min(0).max(10000).optional(),
      },
    },
    (input) => call("overview", input),
  );
  server.registerTool(
    "axpm_company",
    {
      description:
        "기업 ID로 진행횟수·원본 셀·신청 일정·남은 티켓을 조회합니다.",
      inputSchema: { companyId: z.string() },
    },
    (input) => call("company", input),
  );
  server.registerTool(
    "axpm_work_mail",
    {
      description:
        "사용자가 Google 동의와 검색 범위를 설정한 업무 메일의 메타데이터·미리보기만 조회합니다.",
      inputSchema: { companyId: z.string() },
    },
    (input) => call("mail", input),
  );
  server.registerTool(
    "axpm_calendar",
    {
      description: "사용자가 연결한 캘린더의 최대 31일 일정을 조회합니다.",
      inputSchema: { start: z.string(), end: z.string() },
    },
    (input) => call("calendar", input),
  );
  server.registerTool(
    "axpm_propose",
    {
      description:
        "사용자 요청을 근거로 메일·일정·티켓 변경을 제안합니다. 실행 권한은 없으며 운영 콘솔 승인이 필요합니다.",
      inputSchema: {
        userRequest: z.string(),
        proposal: z.object({
          kind: z.enum(["email", "calendar", "ticket"]),
          title: z.string(),
          reason: z.string(),
          evidenceIds: z.array(z.string()),
          companyId: z.string(),
          to: z.string().optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          ticketKind: z.enum(["dedicated", "specialty"]).optional(),
          ticketMode: z.enum(["set", "adjust"]).optional(),
          ticketDelta: z.number().optional(),
          hoursDelta: z.number().optional(),
        }),
      },
    },
    (input) => call("propose", input),
  );
  server.registerTool(
    "axpm_report_draft",
    {
      description:
        "멘토링 메모를 9개 필드로 정리한 보고서 초안을 저장합니다. 원본 템플릿 다운로드는 운영 콘솔에서 검토 후 가능합니다.",
      inputSchema: {
        companyId: z.string(),
        sourceNotes: z.string(),
        fields: z.object({
          company: z.string(),
          representative: z.string(),
          mentor: z.string(),
          datePlace: z.string(),
          attendees: z.string(),
          topic: z.string(),
          companyStatus: z.string(),
          discussion: z.string(),
          nextPlan: z.string(),
        }),
      },
    },
    (input) => call("report_draft", input),
  );
  for (const [name, schema] of Object.entries(workspaceTools)) {
    server.registerTool(
      `axpm_${name}`,
      {
        description: workspaceDescriptions[name as keyof typeof workspaceTools],
        inputSchema: schema.shape,
      },
      (input: unknown) => call(name, input),
    );
  }
}
