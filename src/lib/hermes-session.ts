import { spawn } from "node:child_process";
import { mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiApiKey } from "./gemini-key";

export type HermesTrace = { tool: string; result: string };
export function parseHermesOutput(output: string) {
  const events: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {}
  }
  const result = events.findLast((e) => e.type === "result");
  if (
    !result ||
    result.exit_code !== 0 ||
    typeof result.text !== "string" ||
    !result.text.trim()
  )
    throw new Error(
      "Hermes가 완전한 응답을 반환하지 않았습니다. 실행 로그와 Gemini 인증을 확인해주세요.",
    );
  const trace: HermesTrace[] = events
    .filter((e) => e.type === "tool_result")
    .map((e) => ({
      tool: String(e.name || "MCP"),
      result: e.is_error ? "도구 실행 실패" : "도구 응답 수신",
    }));
  return { summary: result.text, trace };
}
export async function runHermesSession(input: {
  bridgeKey: string;
  origin: string;
  uid: string;
  goal: string;
  model: string;
  scheduled: boolean;
  history: unknown;
  signal: AbortSignal;
}) {
  const directory = await mkdtemp(join(tmpdir(), "axpm-hermes-"));
  try {
    const origin = new URL(input.origin);
    if (
      origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname)
    )
      throw new Error("Hermes MCP 연결은 HTTPS가 필요합니다.");
    await writeFile(
      join(directory, "config.yaml"),
      JSON.stringify({
        model: { default: input.model, provider: "gemini" },
        agent: { max_turns: 16, run_budget_seconds: 420 },
        platform_toolsets: { cli: ["axpm"] },
        mcp_servers: {
          axpm: {
            url: new URL("/api/mcp", origin).href,
            headers: { Authorization: "Bearer ${AXPM_BRIDGE_KEY}" },
            timeout: 120,
          },
        },
      }),
      { mode: 0o600 },
    );
    const skills = ["axpm-monitor", "axpm-report", "axpm-workspace"];
    for (const name of skills)
      await cp(
        join(process.cwd(), ".claude", "skills", name),
        join(directory, "skills", name),
        { recursive: true },
      );
    await writeFile(
      join(directory, "AGENTS.md"),
      "당신은 AXPM 멘토링 운영 에이전트입니다. 한국어로 답하고 AXPM MCP 도구로 원본과 근거를 먼저 조회하세요. 신청이나 파일명만으로 완료를 추정하지 마세요. 마스터 기록은 사용자가 요청한 경우 preview 후 같은 planHash로 apply하세요. 보고서 자동화는 점검, 필요한 원본 확인, 요청된 반영, 마스터 재조회 순서로 진행하세요. 파일명 변경 후에는 실제 이름을 재조회하세요. 정기 실행에서는 조회만 허용하며 오류와 일부 처리 범위를 숨기지 마세요.\n",
    );
    await writeFile(
      join(directory, "query.json"),
      JSON.stringify({
        recentConversation: input.history,
        currentRequest: input.goal,
        scheduled: input.scheduled,
        now: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.env.HERMES_BIN!,
        [
          "chat",
          "--query-file",
          join(directory, "query.json"),
          "--quiet",
          "--format",
          "stream-json",
          "--provider",
          "gemini",
          "--model",
          input.model,
          "-t",
          "axpm",
          "--skills",
          skills.join(","),
          "--max-turns",
          "16",
          "--run-budget",
          "420",
        ],
        {
          cwd: directory,
          signal: input.signal,
          killSignal: "SIGKILL",
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            LANG: process.env.LANG || "C.UTF-8",
            HERMES_HOME: directory,
            GEMINI_API_KEY: geminiApiKey(),
            AXPM_BRIDGE_KEY: input.bridgeKey,
            HERMES_API_TIMEOUT: "120",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        overflow = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 2_000_000) {
          overflow = true;
          child.kill("SIGKILL");
        } else stdout += chunk;
      });
      child.stderr.resume();
      child.once("error", () =>
        reject(
          new Error(
            "Hermes 프로세스를 시작하지 못했거나 실행 시간이 초과됐습니다.",
          ),
        ),
      );
      child.once("close", (code) =>
        code === 0 && !overflow
          ? resolve(stdout)
          : reject(
              new Error(
                `Hermes 실행 실패 (${code ?? "종료"}). Gemini 키·모델과 런타임 설치를 확인해주세요.`,
              ),
            ),
      );
    });
    return parseHermesOutput(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
