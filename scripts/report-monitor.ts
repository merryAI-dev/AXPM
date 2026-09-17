import {
  isQuotaError,
  QUOTA_RETRY_SECONDS,
  QUOTA_MESSAGE,
} from "../src/lib/provider-errors";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { db, userDoc } = await import("../src/lib/firebase");
const { getAuth } = await import("firebase-admin/auth");
const { runReportWatch } = await import("../src/lib/automation/report-watch");
const { isAuthorizedEmail } = await import("../src/lib/access-policy");
db();
const email = process.env.AXPM_MONITOR_EMAIL;
if (!email || !isAuthorizedEmail(email))
  throw new Error("허용된 AXPM_MONITOR_EMAIL이 필요합니다.");
const user = await getAuth().getUserByEmail(email);
if (!user.emailVerified) throw new Error("인증된 운영자 계정이 필요합니다.");
const heartbeat = userDoc(user.uid)
  .collection("automation")
  .doc("reportWorker");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
do {
  let retrySeconds = 60;
  try {
    await heartbeat.set(
      {
        status: "running",
        startedAt: new Date().toISOString(),
        host: "local-launch-agent",
        pid: process.pid,
      },
      { merge: true },
    );
    const result = await runReportWatch(user.uid, true);
    const statuses: Record<string, number> = {};
    if ("results" in result)
      for (const row of result.results || []) {
        const key = String(row.status);
        statuses[key] = (statuses[key] || 0) + 1;
      }
    const record = {
      status: "waiting",
      lastError: "",
      durationMs: "durationMs" in result ? result.durationMs : 0,
      skippedFiles: "skippedFiles" in result ? result.skippedFiles : 0,
      lastSuccessAt: new Date().toISOString(),
      statuses,
      processed: "processed" in result ? result.processed : 0,
      nextOffset: "nextOffset" in result ? result.nextOffset : 0,
      skipped: "skipped" in result && result.skipped === true,
    };
    await heartbeat.set(record, { mergeFields: Object.keys(record) });
    console.log(JSON.stringify(record));
  } catch (error) {
    const quota = isQuotaError(error);
    const message = quota
      ? QUOTA_MESSAGE
      : error instanceof Error
        ? error.message
        : "보고서 감시 실패";
    if (quota) retrySeconds = QUOTA_RETRY_SECONDS;
    if (!quota)
      await heartbeat
        .set(
          {
            status: message.includes("점검 중") ? "waiting" : "error",
            lastError: message,
            checkedAt: new Date().toISOString(),
          },
          { merge: true },
        )
        .catch(() => {});
    console.error(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        error: message,
        status: quota ? "quota-paused" : "error",
        nextRetryAt: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      }),
    );
  }
  if (process.argv.includes("--once") || stopping) break;
  for (let seconds = 0; seconds < retrySeconds && !stopping; seconds++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
} while (!stopping);
