import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import { resolve } from "node:path";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Environment can be supplied by the caller. */
}
const revision = "3c3ab69abb9b08683b5eb15b4e2b8be1198c875f";
const repo = resolve("private/tools/hermes-agent");
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${command} failed`);
}
await mkdir("private/tools", { recursive: true });
try {
  await access(`${repo}/.git`);
} catch {
  run("git", [
    "clone",
    "--no-checkout",
    "--filter=blob:none",
    "https://github.com/NousResearch/hermes-agent.git",
    repo,
  ]);
  run("git", ["-C", repo, "checkout", "--detach", revision]);
}
const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
  encoding: "utf8",
});
if (head.status !== 0 || head.stdout.trim() !== revision)
  throw new Error(
    "Hermes checkout differs from the pinned revision. Keep it separate or inspect the existing checkout.",
  );
run("uv", ["venv", "--allow-existing", "--python", "3.13", `${repo}/.venv`]);
run("uv", [
  "pip",
  "install",
  "--python",
  `${repo}/.venv/bin/python`,
  "-e",
  `${repo}[mcp]`,
]);
run("npm", ["run", "agent:setup"]);
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
])
  await cp(`.claude/skills/${skill}`, `${home}/skills/${skill}`, {
    recursive: true,
  });
console.log(
  "Hermes installed in private/tools; isolated config and four AXPM skills ready. Run npm run hermes -- chat -q '...'.",
);
