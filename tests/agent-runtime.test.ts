import test from "node:test";
import assert from "node:assert/strict";
import { agentRuntime } from "../src/lib/agent-runtime";
import { parseHermesOutput } from "../src/lib/hermes-runtime";
import { chatMessages } from "../src/lib/agent-model";

test("Hermes requires explicit Gemini model, key and executable; removed providers never silently fall back", () => {
  const names = [
    "AGENT_ENGINE",
    "AGENT_PROVIDER",
    "AGENT_MODEL",
    "GEMINI_API_KEY",
    "HERMES_BIN",
  ];
  const old = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    for (const k of names) delete process.env[k];
    assert.equal(agentRuntime().engine, "hermes");
    assert.equal(agentRuntime().configured, false);
    Object.assign(process.env, {
      AGENT_ENGINE: "hermes",
      AGENT_PROVIDER: "gemini",
      AGENT_MODEL: "synthetic-model",
      GEMINI_API_KEY: "synthetic-test-key",
      HERMES_BIN: "/test/hermes",
    });
    assert.equal(agentRuntime().configured, true);
    delete process.env.GEMINI_API_KEY;
    assert.equal(agentRuntime().configured, false);
    process.env.AGENT_PROVIDER = "ollama";
    assert.equal(agentRuntime().configured, false);
  } finally {
    for (const [k, v] of Object.entries(old))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
test("Hermes CLI exit alone is not proof of a model response, and tool failures remain visible", () => {
  assert.throws(() => parseHermesOutput("session_id: abc\n"), /완전한/);
  assert.throws(
    () =>
      parseHermesOutput(
        JSON.stringify({ type: "result", exit_code: 1, text: "bad" }),
      ),
    /완전한/,
  );
  const parsed = parseHermesOutput(
    "notice\n" +
      JSON.stringify({
        type: "tool_result",
        name: "mcp__axpm__axpm_overview",
        is_error: true,
      }) +
      "\n" +
      JSON.stringify({ type: "result", exit_code: 0, text: "조회 실패" }),
  );
  assert.equal(parsed.summary, "조회 실패");
  assert.deepEqual(parsed.trace, [
    { tool: "mcp__axpm__axpm_overview", result: "도구 실행 실패" },
  ]);
});
test("Vertex conversation conversion pairs multiple tool calls with their original IDs", () => {
  const result = chatMessages("rules", [
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "one", name: "first", input: { a: 1 } },
        { type: "tool_use", id: "two", name: "second", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "one", content: "first-result" },
        { type: "tool_result", tool_use_id: "two", content: "second-result" },
      ],
    },
  ]);
  assert.deepEqual(result.slice(2), [
    { role: "tool", tool_call_id: "one", content: "first-result" },
    { role: "tool", tool_call_id: "two", content: "second-result" },
  ]);
});
