import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { issueBridgeKey } from "../src/lib/bridge";
import { db, isEmulator } from "../src/lib/firebase";
import { createHash } from "node:crypto";
process.loadEnvFile(".env.local");
if (!isEmulator()) throw new Error("에뮬레이터에서만 검증합니다.");
const config = JSON.parse(await readFile("private/agent-runtime.json", "utf8"));
const client = new Client({ name: "axpm-http-check", version: "1.0.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", config.baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${config.key}` } },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 13);
  const result = await client.callTool({
    name: "axpm_overview",
    arguments: {},
  });
  assert.equal(result.isError, false);
  const unauthorized = await fetch(new URL("/api/mcp", config.baseURL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  });
  assert.equal(unauthorized.status, 401);
  const scoped = await issueBridgeKey(
    config.uid,
    "operator@axpm.test",
    false,
    true,
  );
  try {
    for (const operation of [
      "agent",
      "propose",
      "propose_drive_change",
      "report_draft",
    ]) {
      const rejected = await fetch(new URL("/api/bridge", config.baseURL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${scoped.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operation, input: {} }),
      });
      assert.equal(rejected.status, 403, operation);
    }
    const forged = await fetch(new URL("/api/mcp", config.baseURL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(forged.status, 403);
  } finally {
    await db()
      .collection("bridgeKeys")
      .doc(createHash("sha256").update(scoped.key).digest("hex"))
      .delete();
  }
  console.log(
    "PASS: HTTP MCP initialize, 13 tools, live Firebase overview read, missing-token rejection.",
  );
} finally {
  await client.close();
}
