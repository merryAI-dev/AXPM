import test from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "../src/lib/read-cache";
import { isQuotaError } from "../src/lib/provider-errors";
test("shared reads are coalesced without crossing user scope", async () => {
  const cached = createReadCache<number>(60000);
  let reads = 0;
  const load = async () => ++reads;
  assert.deepEqual(
    await Promise.all([cached("alice", load), cached("alice", load)]),
    [1, 1],
  );
  assert.equal(await cached("bob", load), 2);
  assert.equal(await cached("alice", load), 1);
  assert.equal(await cached("alice", load, Date.now() + 120000), 3);
});
test("failed reads are not cached and bounded eviction reloads old scopes", async () => {
  const cached = createReadCache<number>(60000, 1);
  await assert.rejects(
    cached("a", async () => {
      throw Error("quota");
    }),
  );
  assert.equal(await cached("a", async () => 1), 1);
  assert.equal(await cached("b", async () => 2), 2);
  assert.equal(await cached("a", async () => 3), 3);
});
test("quota failures are recognized without treating conflicts as quota failures", () => {
  assert.equal(isQuotaError({ code: 8 }), true);
  assert.equal(
    isQuotaError(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded.")),
    true,
  );
  assert.equal(isQuotaError(new Error("마스터 변경 충돌")), false);
});
