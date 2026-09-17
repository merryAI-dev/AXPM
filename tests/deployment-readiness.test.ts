import test from "node:test";
import assert from "node:assert/strict";
import { checkDeployment } from "../scripts/check-deployment.mjs";

test("deployment preflight accepts configured services and verifies Google sign-in without revealing the token", async () => {
  const checks = await checkDeployment(
    {
      project: "test-project",
      region: "asia-northeast3",
      serviceAccount: "runtime",
      storageBucket: "private",
      secrets: { GEMINI_API_KEY: "gemini" },
    },
    {
      command: (args: string[]) => {
        if (args[0] === "billing") return { billingEnabled: true };
        if (args[0] === "services")
          return [
            "run",
            "cloudbuild",
            "artifactregistry",
            "secretmanager",
            "firestore",
            "identitytoolkit",
            "iamcredentials",
            "gmail",
          ].map((name) => ({ config: { name: `${name}.googleapis.com` } }));
        if (args[0] === "storage")
          return {
            uniform_bucket_level_access: true,
            public_access_prevention: "enforced",
          };
        if (args[0] === "secrets") return { state: "ENABLED" };
        if (args[0] === "auth") return { token: "test-token" };
        return {};
      },
      request: async (_url: string, init: RequestInit) => {
        assert.equal(
          (init.headers as Record<string, string>).Authorization,
          "Bearer test-token",
        );
        return new Response(JSON.stringify({ enabled: true }));
      },
    },
  );
  assert.equal(checks.length, 8);
  assert.ok(checks.every((check) => check.ok));
});

test("deployment preflight reports all missing resources and never reads secret values or changes cloud resources", async () => {
  const commands: string[][] = [];
  const checks = await checkDeployment(
    {
      project: "test-project",
      region: "asia-northeast3",
      serviceAccount: "runtime",
      storageBucket: "missing",
      secrets: { GEMINI_API_KEY: "gemini" },
    },
    {
      command: (args: string[]) => {
        commands.push(args);
        if (args[0] === "billing") return { billingEnabled: false };
        if (args[0] === "services") return [];
        if (args[0] === "auth") return { token: "never-log-this-token" };
        throw new Error("조회 실패 또는 권한 없음");
      },
      request: async () => new Response("{}", { status: 404 }),
    },
  );
  assert.equal(checks.length, 8);
  assert.ok(checks.every((check) => !check.ok));
  assert.ok(checks.some((check) => check.detail.includes("HTTP 404")));
  assert.ok(
    commands.every(
      (args) =>
        !args.some((arg) =>
          ["enable", "create", "deploy", "access"].includes(arg),
        ),
    ),
  );
  assert.ok(!JSON.stringify(checks).includes("never-log-this-token"));
});
