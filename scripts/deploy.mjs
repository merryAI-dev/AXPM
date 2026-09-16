// A reviewable deployment plan by default. No Google login or resource mutation without --apply.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
if (
  !Array.isArray(c.allowedEmails) ||
  !c.allowedEmails.length ||
  c.allowedEmails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
)
  throw new Error("Configure exact allowedEmails");
for (const k of ["firebaseApiKey", "firebaseAuthDomain", "storageBucket"])
  if (!c[k] || c[k].includes("YOUR")) throw new Error(`Configure ${k}`);
if (!c.secrets?.TOKEN_ENCRYPTION_KEY || !c.secrets?.CRON_SECRET)
  throw new Error("Secret Manager names for encryption and cron are required");
for (const [k, v] of Object.entries(c.secrets))
  if (!/^[A-Z_]+$/.test(k) || !/^[\w-]+$/.test(v))
    throw new Error("Invalid secret name");
if (
  Object.keys(c.env || {}).some((k) =>
    /SECRET|TOKEN|KEY|EMULATOR|ALLOWED_EMAILS|APP_ORIGIN|FIREBASE_PROJECT_ID/.test(
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
// Provision database, private bucket, Firebase Web app/Auth, runtime service account and billing first.
// This script deliberately does not pick a billing account or create service account keys.
const dir = mkdtempSync(join(tmpdir(), "axpm-deploy-"));
try {
  if (apply) {
    run(["projects", "describe", c.project, "--format=value(projectId)"], true);
    const billing = run(
      [
        "billing",
        "projects",
        "describe",
        c.project,
        "--format=value(billingEnabled)",
      ],
      true,
    );
    if (billing.toLowerCase() !== "true")
      throw new Error(
        "Cloud Run 배포에는 선택한 결제 계정을 프로젝트에 연결해야 합니다. 이 스크립트는 결제 계정을 임의로 선택하지 않습니다.",
      );
    run(
      [
        "iam",
        "service-accounts",
        "describe",
        account,
        `--project=${c.project}`,
      ],
      true,
    );
    run(
      [
        "artifacts",
        "repositories",
        "describe",
        "axpm",
        `--location=${c.region}`,
        `--project=${c.project}`,
      ],
      true,
    );
    for (const secret of Object.values(c.secrets))
      run(["secrets", "describe", secret, `--project=${c.project}`], true);
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
      ALLOWED_EMAILS: c.allowedEmails.join(","),
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
    `Service: ${url}. Enable this domain in Firebase Auth. Configure the OAuth redirect only when reconnecting Google.`,
  );
  if (c.workerUid)
    console.log(
      "Worker configuration: use scripts/worker.mjs with AXPM_BASE_URL, AXPM_WORKER_UID and CRON_SECRET supplied by Secret Manager. Schedule every minute; see deploy/README.md.",
    );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
