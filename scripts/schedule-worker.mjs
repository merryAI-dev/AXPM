// Prints the complete Cloud Run Job + Scheduler commands unless --apply is present.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2),
  apply = args.includes("--apply"),
  configPath = args.find((a) => !a.startsWith("--"));
if (!configPath)
  throw new Error(
    "Usage: node scripts/schedule-worker.mjs private/deploy.json [--apply]",
  );
const c = JSON.parse(readFileSync(configPath, "utf8"));
for (const k of ["project", "region", "service", "serviceAccount"])
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(c[k] || ""))
    throw new Error(`Configure ${k}`);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(c.workerUid || ""))
  throw new Error("Configure the Firebase operator workerUid");
if (
  !/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(
    c.schedulerServiceAccount || "",
  )
)
  throw new Error("Configure schedulerServiceAccount");
if (!/^[\w-]+$/.test(c.secrets?.CRON_SECRET || ""))
  throw new Error("Configure CRON_SECRET Secret Manager name");
function run(a, capture = false) {
  if (!apply) {
    console.log(JSON.stringify(["gcloud", ...a]));
    return capture && a.some((x) => x.includes("containers"))
      ? "DEPLOYED_IMAGE"
      : "https://DEPLOYED_SERVICE_URL";
  }
  const r = spawnSync("gcloud", a, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (r.status !== 0)
    throw new Error(`gcloud ${a.slice(0, 3).join(" ")} failed`);
  return capture ? r.stdout.trim() : "";
}
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
const image = run(
  [
    "run",
    "services",
    "describe",
    c.service,
    `--project=${c.project}`,
    `--region=${c.region}`,
    "--format=value(spec.template.spec.containers[0].image)",
  ],
  true,
);
const job = `${c.service}-worker`,
  runtime = `${c.serviceAccount}@${c.project}.iam.gserviceaccount.com`;
run([
  "run",
  "jobs",
  "deploy",
  job,
  `--project=${c.project}`,
  `--region=${c.region}`,
  `--image=${image}`,
  `--service-account=${runtime}`,
  "--command=node",
  "--args=scripts/worker.mjs",
  "--tasks=1",
  "--parallelism=1",
  "--max-retries=0",
  "--task-timeout=900s",
  "--memory=512Mi",
  `--set-env-vars=AXPM_BASE_URL=${url},AXPM_WORKER_UID=${c.workerUid},AXPM_MONITOR_WORKSPACE=${c.monitorWorkspace === true}`,
  `--set-secrets=CRON_SECRET=${c.secrets.CRON_SECRET}:latest`,
  "--quiet",
]);
run([
  "run",
  "jobs",
  "add-iam-policy-binding",
  job,
  `--project=${c.project}`,
  `--region=${c.region}`,
  `--member=serviceAccount:${c.schedulerServiceAccount}`,
  "--role=roles/run.invoker",
  "--quiet",
]);
const schedulerArgs = [
  c.updateSchedule ? "update" : "create",
  "http",
  job,
  `--project=${c.project}`,
  `--location=${c.region}`,
  `--schedule=${c.workerSchedule || "* * * * *"}`,
  "--time-zone=Asia/Seoul",
  `--uri=https://${c.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${c.project}/jobs/${job}:run`,
  "--http-method=POST",
  `--oauth-service-account-email=${c.schedulerServiceAccount}`,
  "--message-body={}",
  "--max-retry-attempts=0",
  "--quiet",
];
run(["scheduler", "jobs", ...schedulerArgs]);
