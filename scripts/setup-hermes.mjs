import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import { resolve } from "node:path";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Environment can be supplied by the caller. */
}
const repo = resolve("vendor/hermes-agent");
const venv = resolve("private/hermes-venv");
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${command} failed`);
}
await access(`${repo}/pyproject.toml`);
await access(`${repo}/LICENSE`);
await mkdir("private", { recursive: true });
run("uv", ["venv", "--allow-existing", "--python", "3.13", venv]);
run("uv", [
  "pip",
  "install",
  "--python",
  `${venv}/bin/python`,
  "-e",
  `${repo}[mcp]`,
]);
run("npm", ["run", "agent:setup"]);
const envPath = ".env.local";
const localEnv = await readFile(envPath, "utf8");
await writeFile(
  envPath,
  localEnv.replace(/^HERMES_BIN=.*\r?\n?/gm, "").trimEnd() +
    `\nHERMES_BIN=${JSON.stringify(`${venv}/bin/hermes`)}\n`,
  { mode: 0o600 },
);
const connection = JSON.parse(
  await readFile("private/agent-runtime.json", "utf8"),
);
const home = resolve("private/hermes");
await mkdir(home, { recursive: true });
// JSON is valid YAML. No credentials are written to config.yaml.
await writeFile(
  `${home}/config.yaml`,
  JSON.stringify(
    {
      model: { default: process.env.AGENT_MODEL || "", provider: "gemini" },
      agent: { max_turns: 5, run_budget_seconds: 300 },
      platform_toolsets: { cli: ["axpm"] },
      compression: { enabled: true },
      mcp_servers: {
        axpm: {
          url: new URL("/api/mcp", connection.baseURL).href,
          headers: { Authorization: "Bearer ${AXPM_BRIDGE_KEY}" },
          timeout: 120,
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const skill of [
  "axpm-monitor",
  "axpm-report",
  "axpm-tickets",
  "axpm-workspace",
  "hwpx-documents",
])
  await cp(`.claude/skills/${skill}`, `${home}/skills/${skill}`, {
    recursive: true,
  });
console.log(
  "Vendored Hermes installed in private/hermes-venv; isolated config and five AXPM skills ready. Run npm run hermes -- chat -q '...'.",
);
