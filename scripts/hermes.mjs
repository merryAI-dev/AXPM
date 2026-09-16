import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Use supplied environment. */
}
const args = process.argv.slice(2);
if (
  args[0] === "chat" &&
  (!process.env.GEMINI_API_KEY || !process.env.AGENT_MODEL)
)
  throw new Error(
    ".env.local에 GEMINI_API_KEY와 AGENT_MODEL을 설정하세요. Gemini 연결 전에는 모델 응답을 생성하지 않습니다.",
  );
if (args[0] === "chat")
  args.push(
    "--provider",
    "gemini",
    "--model",
    process.env.AGENT_MODEL,
    "-t",
    "axpm",
  );
const config = JSON.parse(await readFile("private/agent-runtime.json", "utf8"));
if (config.expires <= Date.now())
  throw new Error(
    "MCP 키가 만료됐습니다. npm run agent:setup 후 다시 실행하세요.",
  );
const child = spawn(
  resolve("private/tools/hermes-agent/.venv/bin/hermes"),
  args,
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HERMES_HOME: resolve("private/hermes"),
      AXPM_BRIDGE_KEY: config.key,
      HERMES_API_TIMEOUT: "240",
    },
  },
);
child.on("error", () => {
  console.error("먼저 npm run hermes:setup을 실행하세요.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
