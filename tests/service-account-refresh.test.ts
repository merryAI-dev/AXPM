import test from "node:test";
import assert from "node:assert/strict";
import { refreshableServiceClient } from "../src/lib/google-service-account";
test("long-lived Drive clients renew impersonated credentials without a refresh token", async () => {
  let calls = 0;
  const client = await refreshableServiceClient(async () => ({
    access_token: `test-${++calls}`,
    expiry_date: Date.now() + (calls === 1 ? 1000 : 3600000),
  }));
  await client.getRequestHeaders();
  assert.equal(calls, 2);
  assert.equal(client.credentials.access_token, "test-2");
  assert.equal(client.credentials.refresh_token, undefined);
});
