// Restore a project-owned Gemini auth key on a replacement computer; never print the key.
import { spawnSync } from "node:child_process";
import { readFile, writeFile, chmod } from "node:fs/promises";
const [project, keyId, model] = process.argv.slice(2);
if (
  !/^[a-z][a-z0-9-]{4,62}$/.test(project || "") ||
  !/^[a-zA-Z0-9_-]+$/.test(keyId || "") ||
  !/^gemini-[a-zA-Z0-9._-]+$/.test(model || "")
)
  throw new Error(
    "Usage: node scripts/connect-gemini.mjs PROJECT KEY_ID GEMINI_MODEL",
  );
const r = spawnSync(
  "gcloud",
  [
    "services",
    "api-keys",
    "get-key-string",
    keyId,
    `--project=${project}`,
    "--format=json",
  ],
  { encoding: "utf8" },
);
if (r.status !== 0)
  throw new Error(
    "GCP 키를 읽지 못했습니다. 해당 프로젝트의 gcloud 로그인과 API Keys 권한을 확인하세요.",
  );
const key = JSON.parse(r.stdout).keyString;
if (!key) throw new Error("키 응답이 비어 있습니다.");
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
  { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30000) },
);
if (!response.ok)
  throw new Error(
    `Gemini 키/모델 확인 실패 (${response.status}); 기존 로컬 설정을 보존합니다.`,
  );
const metadata = await response.json();
if (!metadata.supportedGenerationMethods?.includes("generateContent"))
  throw new Error("도구 호출용 generateContent 모델이 아닙니다.");
const env = await readFile(".env.local", "utf8");
const kept = env
  .split("\n")
  .filter(
    (l) =>
      !/^(GEMINI_API_KEY|AGENT_ENGINE|AGENT_PROVIDER|AGENT_MODEL)=/.test(l),
  )
  .join("\n")
  .trimEnd();
await writeFile(
  ".env.local",
  `${kept}\nAGENT_ENGINE=hermes\nAGENT_PROVIDER=gemini\nAGENT_MODEL=${model}\nGEMINI_API_KEY=${key}\n`,
  { mode: 0o600 },
);
await chmod(".env.local", 0o600);
console.log(
  `Gemini 인증과 모델 ${model} 확인. 키를 .env.local에 저장했습니다. 추론은 npm run agent:ask로 별도 확인하세요.`,
);
