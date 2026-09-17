import test from "node:test";
import assert from "node:assert/strict";
import { agentRuntime } from "../src/lib/agent-runtime";
import { parseHermesOutput } from "../src/lib/hermes-runtime";

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
    assert.equal(agentRuntime().engine, "builtin");
    assert.equal(agentRuntime().configured, false);
    Object.assign(process.env, {
      AGENT_ENGINE: "hermes",
      AGENT_PROVIDER: "gemini",
      AGENT_MODEL: "synthetic-model",
      GEMINI_API_KEY: "synthetic-test-key",
      HERMES_BIN: "/test/hermes",
    });
    assert.equal(agentRuntime().configured, true);
    process.env.AGENT_ENGINE = "builtin";
    delete process.env.HERMES_BIN;
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
test("Hermes master write capability does not grant recursive agent execution, scheduled runs cannot write", async () => {
  const { hermesPermissions, authorizeBridgeOperation } =
    await import("../src/lib/bridge-policy");
  const interactive = hermesPermissions(false);
  assert.doesNotThrow(() => authorizeBridgeOperation(interactive, "master"));
  assert.doesNotThrow(() =>
    authorizeBridgeOperation(interactive, "record_mentoring"),
  );
  assert.throws(
    () => authorizeBridgeOperation(interactive, "agent"),
    /에이전트 실행 권한/,
  );
  const scheduled = hermesPermissions(true);
  assert.doesNotThrow(() => authorizeBridgeOperation(scheduled, "master"));
  for (const operation of [
    "record_mentoring",
    "apply_report_submissions",
    "apply_report_names",
    "agent",
    "propose_drive_change",
  ])
    assert.throws(
      () => authorizeBridgeOperation(scheduled, operation),
      /조회만/,
    );
  assert.throws(
    () => authorizeBridgeOperation({}, "record_mentoring"),
    /마스터 기록 권한/,
  );
});
