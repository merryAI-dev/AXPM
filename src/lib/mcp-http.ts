import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerMcpTools } from "./mcp-tools";
import { authenticateBridge, bridgeRequest } from "./bridge";
export async function handleMcp(request: Request) {
  await authenticateBridge(request);
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== process.env.APP_ORIGIN)
    return new Response("Forbidden origin", { status: 403 });
  const server = new McpServer({ name: "axpm-operations", version: "0.2.0" });
  registerMcpTools(server, async (operation, input = {}) => {
    try {
      const result = await bridgeRequest(
        new Request(request.url, {
          method: "POST",
          headers: {
            authorization: request.headers.get("authorization") || "",
            "content-type": "application/json",
          },
          body: JSON.stringify({ operation, input }),
        }),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: e instanceof Error ? e.message : "도구 실행 실패",
            }),
          },
        ],
        isError: true,
      };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    await server.close();
  }
}
