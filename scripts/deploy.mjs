// A reviewable deployment plan by default. No Google login or resource mutation without --apply.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkDeployment } from "./check-deployment.mjs";
const args = process.argv.slice(2),
  apply = args.includes("--apply");
const configPath = args.find((x) => !x.startsWith("--"));
if (!configPath)
  throw new Error(
    "Usage: node scripts/deploy.mjs private/deploy.json [--apply]",
  );
const c = JSON.parse(readFileSync(configPath, "utf8"));
for (const k of ["project", "region", "service", "serviceAccount"])
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(c[k] || "") || c[k].includes("YOUR"))
    throw new Error(`Configure ${k}`);
const allowedEmails = Array.isArray(c.allowedEmails) ? c.allowedEmails : [];
const allowedDomains = Array.isArray(c.allowedDomains) ? c.allowedDomains : [];
if (
  (!allowedEmails.length && !allowedDomains.length) ||
  allowedEmails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ||
  allowedDomains.some(
    (domain) => !/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(domain),
  )
)
  throw new Error("Configure allowedEmails or allowedDomains");
if (c.workspaceUid && !/^[A-Za-z0-9_-]{1,128}$/.test(c.workspaceUid))
  throw new Error("Configure workspaceUid");
for (const k of ["firebaseApiKey", "firebaseAuthDomain", "storageBucket"])
  if (!c[k] || c[k].includes("YOUR")) throw new Error(`Configure ${k}`);
if (!c.secrets?.CRON_SECRET || !c.secrets?.GEMINI_API_KEY)
  throw new Error("Secret Manager names for cron and Gemini are required");
for (const key of [
  "AXPM_PROGRAM_NAME",
  "AXPM_MASTER_SPREADSHEET_ID",
  "AXPM_MASTER_SHEET_ID",
  "AXPM_MASTER_SHEET_TITLE",
  "AXPM_MASTER_DASHBOARD_RANGE",
  "AXPM_DRIVE_ROOT_ID",
  "AXPM_REPORT_FOLDER_ID",
  "AXPM_DEFAULT_CAMPUS",
])
  if (!c.env?.[key] || String(c.env[key]).includes("YOUR"))
    throw new Error(`Configure ${key}`);
for (const [k, v] of Object.entries(c.secrets))
  if (!/^[A-Z_]+$/.test(k) || !/^[\w-]+$/.test(v))
    throw new Error("Invalid secret name");
if (
  Object.keys(c.env || {}).some((k) =>
    /SECRET|TOKEN|KEY|EMULATOR|ALLOWED_EMAILS|ALLOWED_DOMAINS|APP_ORIGIN|FIREBASE_PROJECT_ID/.test(
      k,
    ),
  )
)
  throw new Error(
    "Use secrets for credentials; emulator and security overrides are forbidden",
  );
const account = `${c.serviceAccount}@${c.project}.iam.gserviceaccount.com`;
const image = `${c.region}-docker.pkg.dev/${c.project}/axpm/${c.service}:${new Date().toISOString().replace(/[^0-9]/g, "")}`;
function run(args, capture = false) {
  if (!apply) {
    console.log(JSON.stringify(["gcloud", ...args]));
    return "https://SERVICE_URL_AFTER_DEPLOY";
  }
  const r = spawnSync("gcloud", args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (r.status !== 0)
    throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed`);
  return capture ? r.stdout.trim() : "";
}
const dir = mkdtempSync(join(tmpdir(), "axpm-deploy-"));
try {
  if (apply) {
    const readiness = await checkDeployment(c);
    for (const check of readiness)
      console.log(
        `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`,
      );
    if (readiness.some((check) => !check.ok))
      throw new Error(
        "배포 준비 항목을 먼저 완료해주세요. 빌드와 배포를 시작하지 않았습니다.",
      );
  }
  run([
    "builds",
    "submit",
    ".",
    `--project=${c.project}`,
    "--config=deploy/cloudbuild.yaml",
    `--substitutions=_IMAGE=${image},_FIREBASE_API_KEY=${c.firebaseApiKey},_FIREBASE_AUTH_DOMAIN=${c.firebaseAuthDomain}`,
    "--quiet",
  ]);
  const envPath = join(dir, "env.json");
  writeFileSync(
    envPath,
    JSON.stringify({
      FIREBASE_PROJECT_ID: c.project,
      FIREBASE_STORAGE_BUCKET: c.storageBucket,
      ALLOWED_EMAILS: allowedEmails.join(","),
      ALLOWED_DOMAINS: allowedDomains.join(","),
      AXPM_WORKSPACE_UID: c.workspaceUid || "",
      ...c.env,
    }),
    { mode: 0o600 },
  );
  run([
    "run",
    "deploy",
    c.service,
    `--project=${c.project}`,
    `--region=${c.region}`,
    `--image=${image}`,
    `--service-account=${account}`,
    "--port=8080",
    "--memory=1Gi",
    "--cpu=1",
    "--concurrency=8",
    "--min-instances=0",
    "--max-instances=3",
    "--timeout=900",
    `--env-vars-file=${envPath}`,
    `--set-secrets=${Object.entries(c.secrets)
      .map(([k, v]) => `${k}=${v}:latest`)
      .join(",")}`,
    "--allow-unauthenticated",
    "--quiet",
  ]);
  const url = run(
    [
      "run",
      "services",
      "describe",
      c.service,
      `--project=${c.project}`,
      `--region=${c.region}`,
      "--format=value(status.url)",
    ],
    true,
  );
  run([
    "run",
    "services",
    "update",
    c.service,
    `--project=${c.project}`,
    `--region=${c.region}`,
    `--update-env-vars=APP_ORIGIN=${url}`,
    "--quiet",
  ]);
  console.log(
    `Service: ${url}. Enable this domain in Firebase Auth.`,
  );
  if (c.workerUid)
    console.log(
      "Worker configuration: use scripts/worker.mjs with AXPM_BASE_URL, AXPM_WORKER_UID and CRON_SECRET supplied by Secret Manager. Schedule every minute; see deploy/README.md.",
    );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
