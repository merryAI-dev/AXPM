// Stateless dispatcher; Cloud Run Job/Scheduler or a local timer can invoke this.
const { AXPM_BASE_URL, AXPM_WORKER_UID, CRON_SECRET } = process.env;
if (!AXPM_BASE_URL || !AXPM_WORKER_UID || !CRON_SECRET)
  throw new Error("AXPM_BASE_URL, AXPM_WORKER_UID, CRON_SECRET are required");
const url = new URL("/api/worker", AXPM_BASE_URL);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("HTTPS required");
const r = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${CRON_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ uid: AXPM_WORKER_UID }),
  signal: AbortSignal.timeout(850000),
});
if (!r.ok) throw new Error(`Worker request failed: HTTP ${r.status}`);
const data = await r.json();
console.log(
  JSON.stringify({
    id: data.id,
    status: data.status,
    idle: data.idle,
    skipped: data.skipped,
  }),
);
if (["failed", "uncertain"].includes(data.status)) process.exitCode = 1;

if (data.idle && process.env.AXPM_MONITOR_WORKSPACE === "true") {
  const response = await fetch(new URL("/api/cron", AXPM_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uid: AXPM_WORKER_UID, scope: "workspace" }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(`Workspace monitor failed: HTTP ${response.status}`);
  const monitor = await response.json();
  console.log(
    JSON.stringify({
      skipped: monitor.skipped,
      scanned: monitor.scan?.count,
      complete: monitor.scan?.complete,
      queuedJob: monitor.job?.id,
    }),
  );
}

if (process.env.AXPM_MONITOR_REPORTS === "true") {
  const response = await fetch(new URL("/api/cron", AXPM_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uid: AXPM_WORKER_UID, scope: "reports" }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok)
    throw new Error(`Report monitor failed: HTTP ${response.status}`);
  const report = await response.json();
  console.log(
    JSON.stringify({
      reportMonitor: true,
      processed: report.processed,
      totalFiles: report.totalFiles,
      complete: report.complete,
      skipped: report.skipped,
    }),
  );
}
