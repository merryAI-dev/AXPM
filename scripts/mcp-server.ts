import { registerMcpTools } from "../src/lib/mcp-tools";
import {
  workspaceTools,
  workspaceDescriptions,
} from "../src/lib/workspace/agent-tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const origin = process.env.AXPM_BASE_URL || "http://localhost:3000";
const url = new URL(origin);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("원격 AXPM 연결은 HTTPS가 필요합니다.");
const server = new McpServer({ name: "axpm-operations", version: "0.1.0" });
async function call(operation: string, input: unknown = {}) {
  if (!process.env.AXPM_BRIDGE_KEY)
    throw new Error("운영 콘솔에서 발급한 AXPM_BRIDGE_KEY가 필요합니다.");
  const response = await fetch(new URL("/api/bridge", url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AXPM_BRIDGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operation, input }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    isError: !response.ok,
  };
}
registerMcpTools(server, call);
await server.connect(new StdioServerTransport());
