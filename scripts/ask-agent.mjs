import { readFileSync } from "node:fs";
const goal = process.argv.slice(2).join(" ").trim();
if (!goal)
  throw new Error(
    'Usage: npm run agent:ask -- "업로드된 보고서의 실제 셀을 확인해줘"',
  );
const config = JSON.parse(
  readFileSync(
    process.env.AXPM_RUNTIME_FILE || "private/agent-runtime.json",
    "utf8",
  ),
);
if (config.expires < Date.now())
  throw new Error(
    "API 키가 만료되었습니다. npm run agent:setup을 실행해주세요.",
  );
const response = await fetch(new URL("/api/bridge", config.baseURL), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ operation: "agent", input: { goal } }),
  signal: AbortSignal.timeout(550000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
console.log(JSON.stringify(result, null, 2));
