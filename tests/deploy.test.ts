import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const config = {
  project: "axpm-test-project",
  region: "asia-northeast3",
  service: "axpm",
  serviceAccount: "axpm-runtime",
  firebaseApiKey: "public-test-key",
  firebaseAuthDomain: "axpm-test-project.firebaseapp.com",
  storageBucket: "test-private-bucket",
  allowedEmails: ["operator@example.com"],
  secrets: {
    TOKEN_ENCRYPTION_KEY: "token-key-name",
    CRON_SECRET: "cron-key-name",
  },
  workerUid: "test-operator",
  schedulerServiceAccount:
    "scheduler@axpm-test-project.iam.gserviceaccount.com",
  env: {},
};
function plan(script: string, data = config) {
  const dir = mkdtempSync(join(tmpdir(), "axpm-plan-test-"));
  try {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify(data));
    return spawnSync(process.execPath, [resolve("scripts", script), file], {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("deployment and worker plans run without gcloud or network and include bounded retries", () => {
  const web = plan("deploy.mjs");
  assert.equal(web.status, 0, web.stderr);
  assert.match(web.stdout, /--max-instances=3/);
  assert.match(web.stdout, /--set-secrets=/);
  const worker = plan("schedule-worker.mjs");
  assert.equal(worker.status, 0, worker.stderr);
  assert.match(worker.stdout, /--max-retries=0/);
  assert.match(worker.stdout, /--max-retry-attempts=0/);
  assert.match(worker.stdout, /--oauth-service-account-email=/);
});
test("deployment rejects emulator overrides instead of shipping a development auth configuration", () => {
  const rejected = plan("deploy.mjs", {
    ...config,
    env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /overrides are forbidden/);
});
