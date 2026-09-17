// Uses the same registered MCP tools as Hermes, with real Firebase and Google APIs.
import nextEnv from "@next/env";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
nextEnv.loadEnvConfig(process.cwd());
const { db } = await import("../src/lib/firebase");
const { getAuth } = await import("firebase-admin/auth");
const { registerMcpTools } = await import("../src/lib/mcp-tools");
const { callWorkspaceTool } = await import("../src/lib/workspace/agent-tools");
const { isAuthorizedEmail } = await import("../src/lib/access-policy");
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const email = option("--email") || process.env.AXPM_MONITOR_EMAIL;
if (!email || !isAuthorizedEmail(email))
  throw Error("허용된 운영자 --email이 필요합니다.");
db();
const user = await getAuth().getUserByEmail(email);
if (!user.emailVerified) throw Error("인증된 운영자 계정이 필요합니다.");
const server = new McpServer({ name: "axpm-report-sync", version: "1.0.0" });
registerMcpTools(server, async (operation, input) => {
  try {
    const result = await callWorkspaceTool(user.uid, operation, input);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
});
const client = new Client({ name: "axpm-report-cli", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
try {
  const name = args.includes("--apply")
    ? "axpm_apply_report_submissions"
    : "axpm_scan_report_submissions";
  for (let run = 1; run <= (args.includes("--repeat") ? 2 : 1); run++) {
    const response = await client.callTool(
      { name, arguments: option("--file") ? { fileId: option("--file") } : {} },
      undefined,
      { timeout: 600000 },
    );
    console.log(JSON.stringify({ run, tool: name, response }));
    if (response.isError) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.close();
  await server.close();
}
