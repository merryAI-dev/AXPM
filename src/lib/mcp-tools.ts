import { masterRequestSchema } from "./automation/master";
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
    "axpm_master",
    {
      description:
        "설정된 사업관리 마스터의 기업별 완료 회차와 보고서 미기입 현황을 조회합니다.",
      inputSchema: { campus: z.string().max(40).optional() },
    },
    (input) => call("master", input),
  );
  server.registerTool(
    "axpm_record_mentoring",
    {
      description:
        "완료 근거가 있는 멘토링을 지정 마스터에 기록합니다. 먼저 mode=preview, 반영 요청이 있으면 같은 event 및 planHash를 expectedPlan으로 mode=apply 호출합니다. 예약이나 파일명만으로 완료를 추정하지 마세요. 에이전트 실행 권한 키가 필요합니다.",
      inputSchema: masterRequestSchema.shape,
    },
    (input) => call("record_mentoring", input),
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
